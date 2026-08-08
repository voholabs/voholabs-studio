import { redirect } from 'next/navigation';

// The section was called Brain until it was renamed to Brief. Anyone who
// bookmarked a document, or followed a link the agent wrote, still arrives
// here — so the old path forwards to the new one instead of 404ing, keeping
// whichever category and document they were pointing at.
export default async function Index({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  redirect(['/brief', ...(slug || [])].join('/'));
}
