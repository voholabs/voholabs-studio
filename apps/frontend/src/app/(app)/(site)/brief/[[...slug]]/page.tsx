export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AgentBrief } from '@gitroom/frontend/components/agent-brief/agent.brief';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Voholabs Studio' : 'Gitroom'} Brief`,
  description: '',
};
export default async function Index() {
  return <AgentBrief />;
}
