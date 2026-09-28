class GmailError extends Error {
  constructor(code,message){super(message);this.name='GmailError';this.code=code;this.userMessage=message;}
}
module.exports={GmailError};
