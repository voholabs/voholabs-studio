'use client';

import { useTrackView } from '@gitroom/helpers/utils/use.fire.events';
import { FC, useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { AgentBrief } from '@gitroom/frontend/components/agent-brief/agent.brief';
import {
  BRIEF_DOCUMENTS_KEY,
  useBriefDocuments,
} from '@gitroom/frontend/components/agent-brief/use.brief.documents';
import { useWalletAccess } from '@gitroom/frontend/components/wallet-locks/wallet.access';
import { UpgradeBriefButton } from '@gitroom/frontend/components/agent-brief/brief.prompt';
import {
  OnboardingTeach,
  OnboardingTeachHeading,
  useOnboardingStatus,
} from '@gitroom/frontend/components/onboarding/onboarding.teach';
import { useAgentConnection } from '@gitroom/frontend/components/public-api/agent.connection.status';
import { ConnectAgentPanel } from '@gitroom/frontend/components/public-api/public.component';

// Nothing written yet (onboarding's teach step was skipped): the same step
// here, with the prompt to paste into the agent and the list that ticks off
// as it saves. Without an agent, the connect panel comes first. Writing it by
// hand stays one click away.
const BriefTeach: FC<{ onWrite: () => void }> = ({ onWrite }) => {
  const t = useT();
  const { mutate } = useSWRConfig();
  const { data: status } = useOnboardingStatus(true, true);
  const { data: connection } = useAgentConnection(true);
  const done = !!status?.brief?.done;
  // Filled in: the editor takes over.
  useEffect(() => {
    if (done) {
      mutate(BRIEF_DOCUMENTS_KEY);
    }
  }, [done, mutate]);
  return (
    <div className="flex-1 bg-newBgColorInner overflow-y-auto p-[16px] sm:p-[40px]">
      <div className="flex flex-col gap-[24px] w-full max-w-[760px] mx-auto">
        <OnboardingTeachHeading />
        {!!status && !status.agent && (
          <div className="flex flex-col gap-[12px]">
            <div className="text-[18px] font-semibold">
              {t('brief_teach_connect_first', 'First, connect your agent')}
            </div>
            <ConnectAgentPanel bare={true} mcpOnly={true} pickFirst={true} />
          </div>
        )}
        <OnboardingTeach status={status} connection={connection} />
        <button
          type="button"
          onClick={onWrite}
          className="self-center text-[14px] font-[600] text-textItemBlur hover:text-newTextColor underline underline-offset-4"
        >
          {t('brief_write_myself', 'Write it myself instead')}
        </button>
      </div>
    </div>
  );
};

// The wallet plans: the teach step while the brief is empty, the brief
// (with the Improve brief flow) once it is written.
const OpenBrief: FC = () => {
  const { data, isLoading } = useBriefDocuments();
  const [writing, setWriting] = useState(false);

  if (isLoading && !data) {
    return <LoadingComponent />;
  }

  if (!data?.documents?.length && !writing) {
    return <BriefTeach onWrite={() => setWriting(true)} />;
  }

  return <AgentBrief headerAction={<UpgradeBriefButton />} />;
};

export const BriefPage: FC = () => {
  const access = useWalletAccess();
  useTrackView('brief_viewed');

  if (!access) {
    return <LoadingComponent />;
  }
  // A paid plan gets the brief editor as it always did.
  if (access === 'plan') {
    return <AgentBrief headerAction={<UpgradeBriefButton />} />;
  }
  return <OpenBrief />;
};
