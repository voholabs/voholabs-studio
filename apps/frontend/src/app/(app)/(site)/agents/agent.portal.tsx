/**
 * Some deployments run the agent outside Studio - an instance with its own web
 * UI, reached through a portal that mints a signed URL. When
 * NEXT_PUBLIC_AGENT_PORTAL_URL is set, the agents page hands the user over to
 * that instead of rendering the in-app chat.
 *
 * Unset - the default, and the only thing a self-hoster sees - this component
 * is never rendered and the page behaves exactly as it always has.
 */
export const AgentPortal = ({ url }: { url: string }) => {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[16px] text-center min-h-[60vh]">
      <div className="text-[24px]">Your agent</div>
      <div className="text-[14px] opacity-70 max-w-[420px]">
        Your agent runs in its own workspace. It opens in a new tab.
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-forth text-white px-[24px] h-[40px] cursor-pointer items-center justify-center flex"
      >
        Open your agent
      </a>
    </div>
  );
};
