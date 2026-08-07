import { redirect } from 'next/navigation';

// Thread ids belonged to the CopilotKit chat. That code is untouched in
// components/agents, but this section is the per-client Hermes chat now.
export default async function Page() {
  return redirect('/agents');
}
