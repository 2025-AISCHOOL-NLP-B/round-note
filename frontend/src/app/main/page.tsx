"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Dashboard from "@/features/dashboard/Dashboard";
import { checkAuth } from "@/utils/auth";

export default function MainPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    async function verifyAuth() {
      const user = await checkAuth();

      if (user) {
        setIsAuthenticated(true);
      } else {
        // 인증되지 않은 경우 로그인 페이지로
        router.replace("/login");
      }
      setIsChecking(false);
    }

    verifyAuth();
  }, [router]);

  if (isChecking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">인증 확인 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <Dashboard />;
}