import LoginScreen from "@/components/login/LoginScreen";

export const dynamic = "force-dynamic";

// Everyone's way in (#450), from the corner menu; a plain sign-in lands on
// the dashboard.
export default function LoginPage() {
  return <LoginScreen fallback="/" />;
}
