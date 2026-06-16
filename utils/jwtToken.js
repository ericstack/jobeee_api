//Create and send token and save in cookie

const sendToken = async (user, statusCode, res) => {
  //Create JWT token
  const token = await user.getJwtToken();
  //Options for cookie
  const isProd = process.env.NODE_ENV === "production";
  // default to 7 days if COOKIE_EXPIRES_TIME is missing/non-numeric (else
  // Date.now() + NaN -> Invalid Date -> "option expires is invalid")
  const days = Number(process.env.COOKIE_EXPIRES_TIME) || 7;
  const options = {
    expires: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    httpOnly: true,
    // in production the SPA and API may live on different origins (HTTPS) —
    // SameSite=None requires Secure; locally use Lax over HTTP
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  };

  res.status(statusCode).cookie("token", token, options).json({
    success: true,
    token,
  });
};

export default sendToken;
