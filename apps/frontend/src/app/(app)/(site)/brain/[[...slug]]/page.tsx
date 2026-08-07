export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AgentBrain } from '@gitroom/frontend/components/agent-brain/agent.brain';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Voholabs Studio' : 'Gitroom'} Brain`,
  description: '',
};
export default async function Index() {
  return <AgentBrain />;
}
