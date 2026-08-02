'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { FC, useState } from 'react';
import { DiscordDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { DiscordChannelSelect } from '@gitroom/frontend/components/new-launch/providers/discord/discord.channel.select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
const DiscordComponent: FC = () => {
  const form = useSettings();
  const t = useT();
  const [isForum, setIsForum] = useState(false);

  return (
    <div className="flex flex-col gap-[16px]">
      <DiscordChannelSelect
        {...form.register('channel')}
        onChannelChange={(channel) => setIsForum(!!channel?.isForum)}
      />
      {/* A forum post is a thread, so it has to be named. Everywhere else the
          field is meaningless, so it stays hidden. */}
      {isForum && (
        <Input
          label={t('post_title', 'Post title')}
          placeholder={t(
            'discord_forum_title_placeholder',
            'Leave empty to use the first line of the post'
          )}
          maxLength={100}
          {...form.register('title')}
        />
      )}
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: DiscordComponent,
  CustomPreviewComponent: undefined,
  dto: DiscordDto,
  maximumCharacters: 1980,
});
