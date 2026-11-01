import LoginScreen from "@/components/login/LoginScreen";

export const dynamic = "force-dynamic";

// The admin's way in, where the proxy sends a signed-out visit to an admin
// page; a plain sign-in lands in the portal.
export default function LoginPage() {
  return <LoginScreen fallback="/admin" />;
}
