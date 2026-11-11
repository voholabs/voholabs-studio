// Custom flows are made by the user's agent: the "New custom flow" dialog and
// the flow view's "Edit with your agent" write the prompt it is given. Each
// names Voholabs Studio and its request ends with "Based on the following
// information:", what the user typed coming after it.
const copied: string[] = [];
jest.mock('@gitroom/frontend/components/flows/flows.drawer', () => ({
  useCopyPrompt: (prompt?: string) => ({
    copyPrompt: () => prompt && copied.push(prompt),
    label: 'Copy prompt',
  }),
}));
jest.mock('@gitroom/frontend/components/flows/flows.hooks', () => ({
  useFlows: () => ({
    data: [{ id: 'carousel', title: 'LinkedIn carousel', summary: 'Slides' }],
  }),
  useUserFlows: () => ({
    data: {
      locked: false,
      flows: [{ slug: 'weekly-recap', title: 'Weekly recap', summary: '' }],
    },
  }),
  useUserFlow: () => ({ data: undefined }),
  useUserFlowActions: () => ({}),
}));
jest.mock('@gitroom/frontend/components/flows/flows.card', () => ({
  flowCategoryLabel: (_t: unknown, key: string) => key,
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: jest.fn() }),
}));
jest.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => null,
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn(),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string, values?: Record<string, unknown>) =>
    text.replace(/{{(\w+)}}/g, (_m, name) => String(values?.[name] ?? '')),
}));

import { fireEvent, render, screen } from '@testing-library/react';
import {
  describePrompt,
  learnPrompt,
  NewCustomFlow,
  referenceLinks,
} from '@gitroom/frontend/components/flows/flows.new';
import { editFlowPrompt } from '@gitroom/frontend/components/flows/flows.view';

// The request part of a prompt: everything up to the information.
const request = (prompt: string) => prompt.split('\n')[0];

const checkShape = (prompt: string) => {
  expect(request(prompt)).toContain('Voholabs Studio');
  expect(request(prompt).toLowerCase()).toMatch(
    /based on the following information:$/
  );
};

describe('describePrompt', () => {
  it('bases the flow on the flow picked, with what to change after it', () => {
    const prompt = describePrompt(
      { id: 'carousel', title: 'LinkedIn carousel' },
      '  Five slides, never more.  '
    );
    expect(prompt).toBe(
      'Make a custom flow for me using Voholabs Studio and save it to my flows. Base it on the "LinkedIn carousel" flow (carousel): keep its method and change only what I say below. Method and style only: my brand comes from my brief. Show me the flow before saving it. Based on the following information:\n' +
        'Five slides, never more.'
    );
    checkShape(prompt);
  });

  it('writes a flow from scratch on a library engine for media', () => {
    const prompt = describePrompt(undefined, 'A weekly recap of my posts');
    expect(prompt).toBe(
      'Make a custom flow for me using Voholabs Studio and save it to my flows. Write it from scratch: a reusable playbook with the steps, the approval points and the tools each step uses; if it makes a video or images, base it on the closest Voho library flow so its engine renders it. Method and style only: my brand comes from my brief. Show me the flow before saving it. Based on the following information:\n' +
        'A weekly recap of my posts'
    );
    checkShape(prompt);
  });

  it('ends on the request when nothing was typed', () => {
    const prompt = describePrompt(
      { id: 'my/weekly-recap', title: 'Weekly recap' },
      ' '
    );
    expect(prompt).toContain('the "Weekly recap" flow (my/weekly-recap)');
    expect(prompt.endsWith('Based on the following information:')).toBe(true);
  });
});

describe('learnPrompt', () => {
  const head =
    'Learn the video style of these reference videos for me using Voholabs Studio and save it as one of my flows: decode how they are edited (rhythm, hook, text, motion, captions, sound), write it down as a flow I can run on my own topics, and tell me which Voho engine renders it and what it cannot copy yet. Analysis only: never reuse their footage, voice, script or music; delete the downloads when done. Based on the following information:';

  it('lists the reference videos one per line, then my rules', () => {
    const prompt = learnPrompt(
      ['https://www.youtube.com/shorts/a', 'https://www.tiktok.com/@x/video/1'],
      'My orange, my name on the end card'
    );
    expect(prompt).toBe(
      `${head}\n` +
        'Reference videos:\n' +
        'https://www.youtube.com/shorts/a\n' +
        'https://www.tiktok.com/@x/video/1\n' +
        'My rules: My orange, my name on the end card'
    );
    checkShape(prompt);
  });

  it('points at the files attached in the chat when no link is given', () => {
    expect(learnPrompt([], '')).toBe(
      `${head}\nReference videos: the files I attach in this chat`
    );
  });

  it('keeps at most 8 links, one per line, without blank lines', () => {
    const text = Array.from(
      { length: 10 },
      (_, n) => ` https://youtu.be/${n} \n`
    ).join('\n');
    expect(referenceLinks(text)).toEqual(
      Array.from({ length: 8 }, (_, n) => `https://youtu.be/${n}`)
    );
  });
});

describe('editFlowPrompt', () => {
  it('asks the agent to change the flow, named by its slug', () => {
    const prompt = editFlowPrompt(
      { title: 'Weekly recap', slug: 'weekly-recap' },
      'make the hook shorter.'
    );
    expect(prompt).toBe(
      'Update my flow "Weekly recap" using Voholabs Studio: make the hook shorter. Keep the rest as it is, show me the change, then save it. Based on the following information:\n' +
        'My flow: my/weekly-recap'
    );
    checkShape(prompt);
  });

  it('leaves the change to the chat when none is typed', () => {
    expect(
      request(editFlowPrompt({ title: 'Recap', slug: 'recap' }, ''))
    ).toContain('using Voholabs Studio: the change I describe below.');
  });
});

describe('NewCustomFlow', () => {
  beforeEach(() => {
    copied.length = 0;
  });

  it('starts from the flow Customize was pressed on and copies the prompt as typed', () => {
    render(<NewCustomFlow basedOn="carousel" />);
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Five slides' },
    });
    fireEvent.click(screen.getAllByText('Copy prompt')[0]);
    expect(copied).toEqual([
      describePrompt(
        { id: 'carousel', title: 'LinkedIn carousel' },
        'Five slides'
      ),
    ]);
  });

  it('builds the learn-from-videos prompt on its tab and keeps both tabs', () => {
    render(<NewCustomFlow />);
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Recap' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Learn from videos' }));
    const [, links, rules] = screen.getAllByRole('textbox');
    fireEvent.change(links, {
      target: {
        value:
          'https://www.youtube.com/shorts/a\n\nhttps://www.youtube.com/shorts/b',
      },
    });
    fireEvent.change(rules, { target: { value: 'No red' } });
    fireEvent.click(screen.getAllByText('Copy prompt')[1]);
    expect(copied).toEqual([
      learnPrompt(
        [
          'https://www.youtube.com/shorts/a',
          'https://www.youtube.com/shorts/b',
        ],
        'No red'
      ),
    ]);
    // What was typed on the other tab is still there.
    fireEvent.click(screen.getByRole('tab', { name: 'Describe it' }));
    expect(
      (screen.getAllByRole('textbox')[0] as HTMLTextAreaElement).value
    ).toBe('Recap');
  });
});
