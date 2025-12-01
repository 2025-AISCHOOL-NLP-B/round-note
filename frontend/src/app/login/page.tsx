"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Login } from "@/features/auth/Login";
import { useEffect, Suspense } from "react";

function LoginHandler({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    async function checkExistingAuth() {
      const { checkAuth } = await import("@/utils/auth");
      const user = await checkAuth();
      if (user) {
        router.replace("/main");
      }
    }
    checkExistingAuth();
  }, [searchParams, router]);

  return <>{children}</>;
}

export default function LoginPage() {
  const router = useRouter();

  const handleShowRegister = () => {
    router.push("/register");
  };

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginHandler>
        <Login
          onLogin={() => {
            router.replace("/main");
          }}
          onShowRegister={handleShowRegister}
        />
      </LoginHandler>
    </Suspense>
  );
}
