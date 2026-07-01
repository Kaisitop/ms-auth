import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { LoginUserDto, RegisterUserDto, VerifyEmailDto, ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto, RefreshTokenDto, LogoutDto, ResendVerificationDto, CreateUserByAdminDto, BulkImportUsersDto } from './dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern('register.user.auth')
  registerUser(@Payload() registerUserDto: RegisterUserDto) {
    return this.authService.registerUser(registerUserDto);
  }

  @MessagePattern('create.user.by.admin.auth')
  createUserByAdmin(
    @Payload() data: CreateUserByAdminDto & { requestedBy: string },
  ) {
    return this.authService.createUserByAdmin(data);
  }

  @MessagePattern('bulk.import.users.by.admin.auth')
  bulkCreateUsersByAdmin(
    @Payload() data: BulkImportUsersDto & { requestedBy: string },
  ) {
    return this.authService.bulkCreateUsersByAdmin(data);
  }

  @MessagePattern('usuarios.find')
  findUsers(@Payload() filters?: { rol?: string }) {
    return this.authService.findUsers(filters);
  }

  @MessagePattern('login.user.auth')
  loginUser(@Payload() loginUserDto: LoginUserDto) {
    return this.authService.loginUser(loginUserDto);
  }

  @MessagePattern('refresh.token.auth')
  refreshToken(@Payload() tokenDto: RefreshTokenDto) {
    return this.authService.refreshUserToken(tokenDto);
  }

  @MessagePattern('logout.user.auth')
  logoutUser(@Payload() tokenDto: LogoutDto) {
    return this.authService.logoutUser(tokenDto);
  }

  @MessagePattern('verify.email.auth')
  verifyEmail(@Payload() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto);
  }

  @MessagePattern('resend.verification.auth')
  resendVerification(@Payload() resendVerificationDto: ResendVerificationDto) {
    return this.authService.resendVerification(resendVerificationDto);
  }

  @MessagePattern('forgot.password.auth')
  forgotPassword(@Payload() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @MessagePattern('reset.password.auth')
  resetPassword(@Payload() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @MessagePattern('change.password.auth')
  changePassword(
    @Payload() data: ChangePasswordDto & { userId: string },
  ) {
    return this.authService.changePassword(data);
  }

  @MessagePattern('deactivate.user.auth')
  deactivateUser(@Payload() data: { userId: string; requestedBy: string }) {
    return this.authService.deactivateUser(data.userId, data.requestedBy);
  }

  @MessagePattern('usuarios.get_roles')
  getUsersRoles(@Payload() userIds: string[]) {
    return this.authService.getUsersRoles(userIds);
  }

  @MessagePattern('usuarios.get_web_push_recipients')
  getWebPushRecipients() {
    return this.authService.getWebPushRecipients();
  }
}
