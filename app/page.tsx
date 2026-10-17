'use client';

import { useRouter } from 'next/navigation';
import Welcome from '@/components/common/Welcome';
import { useAppAuth } from '@/components/providers/AppProviders';

export default function Home() {
  const router = useRouter();
  const { user, isReady, hasSupabase } = useAppAuth();

  const showAuthenticatedOptions = Boolean(user);
  const authLoading = hasSupabase && !isReady;

  const handleStart = () => {
    if (authLoading) {
      return;
    }
    router.push('/login');
  };

  const handleGoToDashboard = () => {
    router.push('/dashboard');
  };

  return (
    <main className="min-h-screen">
      <Welcome
        positionTitle="PD Plan"
        onStart={handleStart}
        showAuthenticatedOptions={showAuthenticatedOptions}
        onGoToDashboard={handleGoToDashboard}
        loading={authLoading}
      />
    </main>
  );
}
