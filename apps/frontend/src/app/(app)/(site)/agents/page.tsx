export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { HermesChat } from '@gitroom/frontend/components/hermes/hermes.chat';

export const metadata: Metadata = {
  title: 'Voholabs Studio - Agent',
  description: '',
};

export default async function Page() {
  return <HermesChat />;
}
