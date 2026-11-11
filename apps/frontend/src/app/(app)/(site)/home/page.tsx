export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { HomePage } from '@gitroom/frontend/components/home/home.page';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Voholabs Studio' : 'Gitroom'} Home`,
  description: '',
};
export default async function Index() {
  return <HomePage />;
}
