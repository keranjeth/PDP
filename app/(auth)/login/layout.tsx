import { redirectToDashboardIfAuthed } from '@/lib/auth/rsc-guards';

export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await redirectToDashboardIfAuthed();
  return children;
}
