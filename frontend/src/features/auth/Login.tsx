"use client"

import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Separator } from '@/shared/ui/separator';
import Image from "next/image";

interface LoginProps {
  onLogin: () => void;
  onShowRegister: () => void;
}

export function Login({ onLogin, onShowRegister }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // httpOnly Cookie를 받기 위해 필요
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('로그인 성공:', data.message);
        // 토큰은 httpOnly Cookie에 저장되므로 localStorage 사용 안 함
        onLogin();
      } else {
        setError('로그인 실패: 서버 응답을 확인해주세요.');
      }
    } catch (err) {
      console.error('로그인 중 오류 발생:', err);
      setError('로그인 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  }

  const handleGoogleLogin = () => {
    console.log('구글 로그인 시도');
    // 백엔드 Google OAuth 엔드포인트로 리다이렉트
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/google/login`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-white to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl border-primary/20">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center mb-4">
            <Image
              src="/1479b69d0df16b28749512726e3ffc0f8c722c85.png"
              alt="RoundNote Logo"
              width={80}
              height={80}
              className="h-20 w-auto"
              unoptimized
            />
          </div>
          <CardTitle className="text-2xl">RoundNote에 오신 것을 환영합니다</CardTitle>
          <CardDescription>
            회의록을 스마트하게 관리하세요
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* 이메일 로그인 폼 */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                placeholder="example@roundnote.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="비밀번호를 입력하세요"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90"
              size="lg"
            >
              로그인
            </Button>
          </form>

          <div className="text-center text-sm">
            <span className="text-muted-foreground">계정이 없으신가요? </span>
            <button
              onClick={onShowRegister}
              className="text-primary hover:underline"
            >
              회원가입
            </button>
          </div>

          <div className="relative my-4">
            <Separator />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="px-2 bg-white text-sm text-muted-foreground">또는</span>
            </div>
          </div>

          {/* 소셜 로그인 */}
          <div className="space-y-2">
            <Button
              onClick={handleGoogleLogin}
              variant="outline"
              className="w-full h-11 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              구글로 시작하기
            </Button>
          </div>

          <Separator />

          <p className="text-xs text-center text-muted-foreground mt-4">
            로그인하면 RoundNote의{' '}
            <a href="#" className="text-primary hover:underline">
              서비스 약관
            </a>
            {' '}및{' '}
            <a href="#" className="text-primary hover:underline">
              개인정보 처리방침
            </a>
            에 동의하게 됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}