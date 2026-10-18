export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { FlowsPage } from '@gitroom/frontend/components/flows/flows.page';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Voholabs Studio' : 'Gitroom'} Flows`,
  description: '',
};
export default async function Index() {
  return <FlowsPage />;
}
