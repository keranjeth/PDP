import MainAppShell from './main-app-shell';
import { requireUserForMainLayout } from '@/lib/auth/rsc-guards';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUserForMainLayout();
  return <MainAppShell>{children}</MainAppShell>;
}
