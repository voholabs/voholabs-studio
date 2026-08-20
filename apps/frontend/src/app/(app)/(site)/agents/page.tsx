export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { HermesChat } from '@gitroom/frontend/components/hermes/hermes.chat';
import { AgentPortal } from './agent.portal';

export const metadata: Metadata = {
  title: 'Voholabs Studio - Agent',
  description: '',
};

export default async function Page() {
  // Deployments that run the agent elsewhere set NEXT_PUBLIC_AGENT_PORTAL_URL
  // and get a hand-off button. Everyone else - including every self-hoster -
  // gets the in-app chat, unchanged.
  const portalUrl = process.env.NEXT_PUBLIC_AGENT_PORTAL_URL;

  if (portalUrl) {
    return <AgentPortal url={portalUrl} />;
  }

  return <HermesChat />;
}
