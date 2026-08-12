# The agent brief

The brief is the description of a business that steers everything the agent publishes on its behalf. `brief.types.ts` holds the shape, `brief.registry.ts` holds what exists, and the agent reaches both through `briefListTool` and `briefSaveTool`.

## The content model, in one paragraph

A document is a list of **blocks**. A block is a heading and a body, and that is the whole model. The heading is the key, the body is the value. There is no nesting, no list type, no table type. A document may also carry **links** and **assets** when its category opts into those features.

The body is stored and rendered as written. **It is not markdown and not HTML.** Sending `# Heading` puts a literal hash on the page. Sending `**bold**` puts literal asterisks on the page. Formatting that arrives as markup does not survive as formatting, it survives as noise.

The practical consequence: when you have a structured document to store, the structure goes into the blocks, not into the body. Six ideas means six blocks with six headings, not one block containing six markdown sections. Anything that would have been a markdown heading is a block heading instead.

## The four categories

| Category | Source | Who creates documents | What it holds |
|---|---|---|---|
| `foundation` | static | nobody, the list is fixed | North Star, voice, boundaries, ICP and the rest |
| `sources` | user | anyone, `canCreate` | Places the agent may read from |
| `experience` | user | the agent, `agentManaged` | What the agent has worked out about this brand |
| `channels` | integration | created per connected channel | Per channel steering |

`source: 'static'` means the documents are fixed in the registry and only their contents change. `'user'` means documents are created and named as needed. `'integration'` means one document appears per connected channel.

## Sources: one document per source

This is the part that gets written wrongly, so it is worth being blunt about.

A source is **one place the agent can read from**. The forum is a source. Notion is a source. A Postgres database of community activity is a source. Each gets **its own document**, with its own short key (`forum`, `discord`, `notion`), its own title, and its own link.

A single document called "Sources" that describes every source in one body is the wrong shape twice over: it collapses several documents into one, and it usually smuggles markdown into a body to fake the structure the blocks were there to provide.

The template says what a source document is for:

```ts
const SOURCE_TEMPLATE: BriefDocumentDef = {
  key: 'source',
  label: 'Source',
  description: 'Links the agent can draw on, and how to use them.',
  icon: 'link',
  features: ['links'],
};
```

Note `features: ['links']`. **The link is the source.** The blocks say how to use it, when to trust it, and what it does not cover. A source document saved with no link describes a source rather than being one.

A source document that reads well tends to answer: what it is, how to read it, what it answers well, how to cite it, how fresh it is, and what it deliberately does not cover.

## Writing is a replace, not a merge

`briefSaveTool` replaces the whole document. Rules omitted from the call are deleted, which is why the tool is annotated `destructiveHint: true`. Always read with `briefListTool` first and send back the existing rules plus the change.

The one exception is `experience`, which the agent maintains itself through `briefLearnTool`. That revises a single lesson at a time rather than replacing the document, and needs no permission, because the content is the agent's own notes rather than the user's instructions.

## Adding a category

Add the id to `BriefCategoryId`, then add the definition to the registry. A static category needs a `documents` list; a user or integration category needs a `documentTemplate`. Set `canCreate` and `canDelete` deliberately: they are what decides whether a new key is allowed, and `briefSaveTool` refuses a new key in a category that does not permit one.
