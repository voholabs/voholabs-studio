export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { FlowsSharedPage } from '@gitroom/frontend/components/flows/flows.shared';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';

// A flow someone shared: signed in only (the app layout), with an import into
// My flows.
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Voholabs Studio' : 'Gitroom'} Shared flow`,
  description: '',
};

export default async function Index({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <FlowsSharedPage token={token} />;
}
