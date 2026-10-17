import { requireUserForChangePasswordPage } from '@/lib/auth/rsc-guards';

export default async function ChangePasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUserForChangePasswordPage();
  return children;
}
