"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkAuth } from "@/utils/auth";

export default function Page() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    async function verifyAuth() {
      const user = await checkAuth();
      
      if (user) {
        // 인증된 경우 메인 페이지로
        router.replace("/main");
      } else {
        // 인증되지 않은 경우 로그인 페이지로
        router.replace("/login");
      }
      setIsChecking(false);
    }
    
    verifyAuth();
  }, [router]);

  // 리다이렉트 중에는 빈 화면 표시
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted-foreground">로딩 중...</p>
      </div>
    </div>
  );
}