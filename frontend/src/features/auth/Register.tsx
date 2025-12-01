import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Checkbox } from '@/shared/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import Image from "next/image";


interface RegisterProps {
  onRegister: () => void;
  onBackToLogin: () => void;
}

export function Register({ onRegister, onBackToLogin }: RegisterProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [error, setError] = useState('');

  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const validatePassword = (password: string) => {
    // 최소 8자, 영문, 숫자 포함
    return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('이름을 입력해주세요.');
      return;
    }

    if (!validateEmail(email)) {
      setError('올바른 이메일 형식이 아닙니다.');
      return;
    }

    if (!validatePassword(password)) {
      setError('비밀번호는 최소 8자 이상, 영문과 숫자를 포함해야 합니다.');
      return;
    }

    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    if (!agreedToTerms || !agreedToPrivacy) {
      setError('필수 약관에 동의해주세요.');
      return;
    }

    // 백엔드 API를 통한 회원가입 처리
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // httpOnly Cookie를 받기 위해 필요
        body: JSON.stringify({ email, password, name }),
      });

      if (response.ok) {
        // 회원가입 성공 - 로그인 페이지로 이동
        toast.success('회원가입이 완료되었습니다. 로그인해주세요.');
        setTimeout(() => {
          onBackToLogin(); // 로그인 페이지로 이동
        }, 1000);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || '회원가입에 실패했습니다.');
      }
    } catch (err) {
      console.error('회원가입 중 오류 발생:', err);
      setError('회원가입 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  };

  const passwordStrength = (password: string) => {
    if (password.length === 0) return { text: '', color: '' };
    if (password.length < 8) return { text: '약함', color: 'text-red-500' };
    if (!validatePassword(password)) return { text: '보통', color: 'text-orange-500' };
    if (password.length >= 12 && /[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return { text: '강함', color: 'text-green-500' };
    }
    return { text: '보통', color: 'text-[#FFA726]' };
  };

  const strength = passwordStrength(password);

  return (
    <div className="min-h-screen flex items-center justify-center px-12">
      <Card className="w-4xl max-w-md shadow-md border border-gray-200">
        <CardHeader className="space-y-4 pb-6">
          <div className="flex justify-center">
            <Image
              src="/1479b69d0df16b28749512726e3ffc0f8c722c85.png"
              alt="RoundNote Logo"
              width={80}
              height={80}
              className="h-20 w-auto"
              unoptimized
            />
          </div>

          <div className="text-center">
            <CardTitle className="text-2xl text-foreground">회원가입</CardTitle>
            <CardDescription className="mt-2">
              RoundNote와 함께 스마트한 회의 관리를 시작하세요
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">이름</Label>
              <Input
                id="name"
                type="text"
                placeholder="홍길동"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                placeholder="example@roundnote.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="영문, 숫자 포함 8자 이상"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password && (
                <p className={`text-xs ${strength.color}`}>
                  비밀번호 강도: {strength.text}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">비밀번호 확인</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="비밀번호를 다시 입력하세요"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && (
                <div className="flex items-center gap-1 text-xs">
                  {password === confirmPassword ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                      <span className="text-green-500">비밀번호가 일치합니다</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3 h-3 text-red-500" />
                      <span className="text-red-500">비밀번호가 일치하지 않습니다</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="terms"
                  checked={agreedToTerms}
                  onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
                />
                <label
                  htmlFor="terms"
                  className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  <span className="text-red-500">*</span> 이용약관에 동의합니다
                </label>
              </div>
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="privacy"
                  checked={agreedToPrivacy}
                  onCheckedChange={(checked) => setAgreedToPrivacy(checked as boolean)}
                />
                <label
                  htmlFor="privacy"
                  className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  <span className="text-red-500">*</span> 개인정보 처리방침에 동의합니다
                </label>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90"
              size="lg"
            >
              회원가입
            </Button>

            <div className="text-center text-sm">
              <span className="text-muted-foreground">이미 계정이 있으신가요? </span>
              <button
                type="button"
                onClick={onBackToLogin}
                className="text-primary hover:underline"
              >
                로그인
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
