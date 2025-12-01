"use client";

import { useRouter } from "next/navigation";
import { Register } from "@/features/auth/Register";

export default function RegisterPage() {
  const router = useRouter();

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary/10 via-white to-blue-50 p-4">
      <Register
        onRegister={() => {
          // 사용되지 않음 - Register 컴포넌트에서 onBackToLogin 호출
          router.push("/login");
        }}
        onBackToLogin={() => {
          router.push("/login");
        }}
      />
    </div>
  );
}