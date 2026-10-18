import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
import { PlusPage } from '@gitroom/frontend/components/plus/plus.page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Voholabs Studio' : 'Gitroom'} Plus`,
  description: '',
};

export default async function Page() {
  return <PlusPage />;
}
