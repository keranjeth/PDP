import { redirectToDashboardIfAuthed } from '@/lib/auth/rsc-guards';

export default async function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await redirectToDashboardIfAuthed();
  return children;
}
