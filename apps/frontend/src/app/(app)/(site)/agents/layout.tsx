import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Voholabs Studio - Agent',
  description: 'agent',
};
// The CopilotKit shell that used to wrap this route still lives in
// components/agents; this section now talks to each client's own Hermes agent.
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
