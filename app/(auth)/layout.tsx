import { AuthBackground } from '@/components/auth/AuthShell';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthBackground>{children}</AuthBackground>;
}
