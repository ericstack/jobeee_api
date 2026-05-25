import User from "../models/users.js";
import catchAsyncErrors from "../middleware/catchAsyncErrors.js";
import crypto from "crypto";
import ErrorHandler from "../utils/errorHandler.js";
import sendToken from "../utils/jwtToken.js";
import sendEmail from "../utils/sendEmail.js";

//register a new user => api/v1/register
export const registerUser = catchAsyncErrors(async (req, res, next) => {
  const { name, email, password, role } = req.body;

  const user = await User.create({
    name,
    email,
    password,
    role,
  });
  // JWT token
  const token = await user.getJwtToken();

  res.status(200).json({
    success: true,
    message: "User is registered",
    token,
  });
});
// Login user => /api/v1/login

export const loginUser = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;

  //check if email or password is entered by user
  if (!email || !password) {
    return next(new ErrorHandler("Please enter email and password!"), 400);
  }

  //finding user in database
  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    return next(new ErrorHandler("Invalid Email or Password", 401));
  }

  //Check if password is correct
  const isPasswordMatched = await user.comparePassword(password);

  if (!isPasswordMatched) {
    return next(new ErrorHandler("Invalid Email or Password", 401));
  }

  //Create JSON Web token

  // const token = user.getJwtToken()

  // res.status(200).json({
  //     success:true,
  //     token
  // })
  const usertoken = await user.getJwtToken();

  await sendToken(user, 200, res);
});
// forgot password => /api/v1/password/forgot
export const forgotPassword = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });

  //check user email in db
  if (!user) {
    return next(new ErrorHandler("No user found with this email", 404));
  }

  // Get reset token
  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });

  //Create reset password URL
  const resetUrl = `${req.protocol}://${req.get("host")}/api/v1/password/reset/${resetToken}`;

  const message = `Your password reset link is as follow:\n\n${resetUrl} 
    \n\n if you have not request this, then ignore.`;

  try {
    // await sendEmail({
    //   email: user.email,
    //   subject: "Jobbee Password reset email",
    //   message,
    // });

    res.status(200).json({
      success: true,
      message: `Email Sent successfully to: ${user.email}`,
    });
  } catch (error) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save({ validateBeforeSave: false });

    return next(new ErrorHandler("Email is not sent."), 500);
  }
});
//Reset Password => /api/v1/password/reset/:token
export const resetPassword = catchAsyncErrors(async (req, res, next) => {
  //Hash url token
  // console.log(req.params.token)
  const resetPasswordToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() },
  });
  if (!user) {
    return next(
      new ErrorHandler("Password reset token is invalid or has expired"),
      400,
    );
  }

  //setup new password
  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;

  await user.save();

  sendToken(user, 200, res);
});
// Get currently logged in user details => /api/v1/me
export const getUserProfile = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  res.status(200).json({
    success: true,
    token: await user.getJwtToken(),
    user,
  });
});

// Logout user   =>   /api/v1/logout
export const logout = catchAsyncErrors(async (req, res, next) => {
  res.cookie("token", "none", {
    expires: new Date(Date.now()),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully.",
  });
});
