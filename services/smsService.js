const axios = require('axios');

/**
 * Send real SMS OTP to phone number
 * Supports:
 * 1. 2Factor.in (India) - with custom template (e.g. LifeLineOTP) or default AUTOGEN
 * 2. Fast2SMS (India)
 * 3. Twilio (Global)
 */
async function sendSmsOtp(phone, otp) {
  const cleanPhone = phone.toString().replace(/\D/g, '').slice(-10);

  // ==========================================
  // 1. 2Factor.in (India) - https://2factor.in
  // ==========================================
  if (process.env.TWOFACTOR_API_KEY && process.env.TWOFACTOR_API_KEY.trim()) {
    try {
      const apiKey = process.env.TWOFACTOR_API_KEY.trim();
      const template = process.env.TWOFACTOR_TEMPLATE_NAME ? process.env.TWOFACTOR_TEMPLATE_NAME.trim() : '';

      // If custom template is provided, use the template endpoint:
      // https://2factor.in/API/V1/{apiKey}/SMS/{phone}/{otp}/{template}
      // If no template, use AUTOGEN for default DLT approved SMS
      const phoneWithCode = cleanPhone.startsWith('91') && cleanPhone.length === 12 ? '+' + cleanPhone : '+91' + cleanPhone;
      // Default to AUTOGEN for guaranteed 2Factor-managed DLT SMS text delivery without voice calls
      const url = (template && template.toLowerCase() !== 'autogen' && template.toLowerCase() !== 'default')
        ? `https://2factor.in/API/V1/${apiKey}/SMS/${phoneWithCode}/${otp}/${template}`
        : `https://2factor.in/API/V1/${apiKey}/SMS/${phoneWithCode}/AUTOGEN`;

      console.log(`[SMS 2Factor] Sending OTP to +91 ${cleanPhone} ${template ? `using template '${template}'` : 'using default template'}...`);
      console.log(`[SMS 2Factor URL]: ${url}`);

      const response = await axios.get(url, { timeout: 15000 });
      console.log('[SMS 2Factor Response]:', response.data);

      if (response.data && response.data.Status === 'Success') {
        return {
          success: true,
          provider: '2factor',
          sessionId: response.data.Details,
          otp,
        };
      }

      console.warn('[SMS 2Factor Warning] API returned non-success:', response.data);
      return { success: false, provider: '2factor', error: response.data };
    } catch (err) {
      console.error('[SMS 2Factor Error]:', err.response?.data || err.message);
    }
  }

  // ==========================================
  // 2. Fast2SMS (India) - https://fast2sms.com
  // ==========================================
  if (process.env.FAST2SMS_API_KEY && process.env.FAST2SMS_API_KEY.trim()) {
    try {
      const response = await axios.post(
        'https://www.fast2sms.com/dev/bulkV2',
        {
          route: 'otp',
          variables_values: otp,
          numbers: cleanPhone,
        },
        {
          headers: {
            authorization: process.env.FAST2SMS_API_KEY.trim(),
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      console.log(`[SMS Fast2SMS] Sent OTP to +91 ${cleanPhone}:`, response.data);
      return { success: true, provider: 'fast2sms', otp };
    } catch (err) {
      console.error(`[SMS Fast2SMS Error] Failed for +91 ${cleanPhone}:`, err.response?.data || err.message);
    }
  }

  // ==========================================
  // 3. Twilio (Global) - https://twilio.com
  // ==========================================
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID.trim();
      const token = process.env.TWILIO_AUTH_TOKEN.trim();
      const from = process.env.TWILIO_PHONE_NUMBER.trim();
      const to = cleanPhone.startsWith('+') ? cleanPhone : '+91' + cleanPhone;
      const auth = Buffer.from(sid + ':' + token).toString('base64');
      const params = new URLSearchParams();
      params.append('To', to);
      params.append('From', from);
      params.append('Body', `Your LifeLine verification code is: ${otp}. Valid for 5 minutes.`);

      const response = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        params.toString(),
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        }
      );
      console.log(`[SMS Twilio] Sent OTP to ${to}:`, response.data.sid);
      return { success: true, provider: 'twilio', otp };
    } catch (err) {
      console.error(`[SMS Twilio Error] Failed for +91 ${cleanPhone}:`, err.response?.data || err.message);
    }
  }

  // Fallback / Development mode notification in backend console
  console.log('\n======================================================');
  console.log(`[SMS ALERT] Real-time OTP for +91 ${cleanPhone} is: >>> ${otp} <<<`);
  console.log('======================================================\n');

  return { success: false, provider: 'console_dev', message: 'No SMS gateway key configured', otp };
}

/**
 * Verify OTP with 2Factor.in
 */
async function verify2FactorOtp(sessionId, otp) {
  if (!process.env.TWOFACTOR_API_KEY || !sessionId) return false;
  try {
    const apiKey = process.env.TWOFACTOR_API_KEY.trim();
    const cleanOtp = otp.toString().trim();
    const url = `https://2factor.in/API/V1/${apiKey}/SMS/VERIFY/${sessionId}/${cleanOtp}`;

    console.log('[SMS 2Factor Verify] Checking OTP with 2Factor...');
    const response = await axios.get(url, { timeout: 10000 });
    console.log('[SMS 2Factor Verify Response]:', response.data);

    return response.data && response.data.Status === 'Success' && response.data.Details === 'OTP Matched';
  } catch (err) {
    console.error('[SMS 2Factor Verify Error]:', err.response?.data || err.message);
    return false;
  }
}

module.exports = {
  sendSmsOtp,
  verify2FactorOtp,
};
