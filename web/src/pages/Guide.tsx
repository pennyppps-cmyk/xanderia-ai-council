import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { cx, Icon } from '../components/ui';
import { tl } from '../i18n';
import { Shell } from './Plan';

/**
 * The in-app user guide: how to use every part of the Council, with screenshots. The full manual
 * (more detail, admin setup) is the PDF linked at the top.
 */
const PDF = '/guide/Xanderia-AI-Council-User-Guide.pdf';

const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="my-3 space-y-2">
    {items.map((s, i) => (
      <li key={i} className="flex gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">{i + 1}</span>
        <span className="text-sm leading-6 text-ink-700">{s}</span>
      </li>
    ))}
  </ol>
);
const Bullets = ({ items }: { items: ReactNode[] }) => (
  <ul className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-ink-700">
    {items.map((s, i) => <li key={i}>{s}</li>)}
  </ul>
);
const Shot = ({ src, caption }: { src: string; caption: string }) => (
  <figure className="my-4">
    <a href={`/guide/${src}.jpg`} target="_blank" rel="noreferrer" title={tl('Open full size')}>
      <img src={`/guide/${src}.jpg`} alt={caption} loading="lazy" className="w-full rounded-lg border border-ink-100 shadow-sm" />
    </a>
    <figcaption className="mt-1.5 text-xs italic text-ink-500">{caption}</figcaption>
  </figure>
);
const Tip = ({ children, label = 'Tip' }: { children: ReactNode; label?: string }) => (
  <div className="my-3 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-ink-700">
    <span className="font-semibold text-accent-800">{label}: </span>
    {children}
  </div>
);
const P = ({ children }: { children: ReactNode }) => <p className="my-2 text-sm leading-6 text-ink-700">{children}</p>;
const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-5 text-sm font-semibold text-ink-900">{children}</h3>;
const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-ink-900">{children}</strong>;
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-amber-50 px-1 font-mono text-[0.8em] text-amber-900">{children}</code>;

interface Section {
  id: string;
  title: string;
  who: 'Everyone' | 'Collections & Finance' | 'Department leads' | 'Admins';
  keywords: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'Getting started',
    who: 'Everyone',
    keywords: 'sign in login home sidebar language bm english password',
    body: (
      <>
        <P>Open the Council address in your browser (desktop or phone) and sign in with your work email. Your administrator creates your account; the invite email lets you set your own password. Forgot it? Use <B>Forgot password?</B> on the sign-in page.</P>
        <Shot src="02-home" caption="The home screen: templates and examples, your history on the left, the question box at the bottom." />
        <Bullets
          items={[
            <><B>Sidebar:</B> New question, search, your conversations, then the bell (notifications), Tasks, Decisions, Tools, Document templates, Notis blast (Collections), Admin, and this guide (<B>?</B>).</>,
            <><B>Question box:</B> choose <B>Auto / Quick / Council</B>, the department, attach a document, pick a template, or tick Peer review. Enter sends; Shift+Enter adds a line.</>,
            <><B>EN / BM:</B> switches every screen between English and Bahasa Malaysia. Answers follow the language you write in.</>,
            <><B>Help:</B> the <B>?</B> button at the top of each page (or in the sidebar) opens the part of this guide for that page.</>,
          ]}
        />
        <Tip label="Remember">Everything the Council says is advice. Final decisions sit with the responsible staff and management; legal and finance answers must be reviewed before acting.</Tip>
      </>
    ),
  },
  {
    id: 'quick',
    title: 'Ask a quick question',
    who: 'Everyone',
    keywords: 'quick answer sources department ask',
    body: (
      <>
        <Steps items={['Choose Quick (or leave Auto).', 'Pick the department whose expert should answer. It defaults to yours.', 'Type the question and press Enter. The answer appears in a few seconds.', 'If documents were used, the sources are listed as [S1], [S2] with the document and page.']} />
        <Shot src="03-quick" caption="A quick answer. “Processed on-premises” means nothing left Xanderia's servers." />
        <Tip>Give the details that matter: which product, which branch, the amounts. The advisors only know Xanderia's figures if you tell them.</Tip>
      </>
    ),
  },
  {
    id: 'council',
    title: 'Bring a plan or decision to the council',
    who: 'Everyone',
    keywords: 'council verdict chairman advisors clarifying questions open questions follow up what if peer review report pdf',
    body: (
      <>
        <P>Six advisors with different mandates look at your plan independently; the Chairman weighs them and returns one verdict with an action plan, risks, open questions and a confidence level. A council takes about 20–40 seconds on our GPU (longer with peer review).</P>
        <Steps
          items={[
            'Choose Council (or Auto: plans and decisions go to the council automatically).',
            'Describe the goal, the numbers (volumes, amounts, budget, staff), the constraints and the deadline.',
            'If key facts are missing, the council asks up to 3 questions first. Answer them in one message, or press Skip.',
            'Read the verdict. Click an open question to answer it: the council reconsiders with your answer, and confirmed facts carry into follow-ups.',
          ]}
        />
        <Shot src="04-clarify" caption="Clarifying questions before the council meets, with what it will assume if you skip." />
        <Shot src="06-verdict" caption="The verdict: decision, confidence, reasoning and how disagreements were settled." />
        <H3>After the verdict</H3>
        <Bullets
          items={[
            <><B>Follow-up:</B> just type in the same conversation; the council remembers the verdict. Short follow-ups (“what about Ipoh?”) are understood in context.</>,
            <><B>What if…:</B> change one assumption; two advisors re-run and the Chairman updates the verdict.</>,
            <><B>Download report (PDF):</B> executive summary, stance map, risk heat map, timeline and every advisor's opinion.</>,
            <><B>Share, Copy, Word, Draft a document</B> (SOP, policy, customer letter, staff memo), thumbs up/down.</>,
            <><B>Record as decision</B> adds it to the decision register; <B>Put into action</B> hands it to the Action Crew.</>,
          ]}
        />
        <Shot src="26-whatif" caption="What if…: the updated verdict appears as a new answer so you can compare." />
      </>
    ),
  },
  {
    id: 'attach',
    title: 'Attach a document for the council to judge',
    who: 'Everyone',
    keywords: 'attach upload pdf word excel paperclip document plan judge',
    body: (
      <>
        <Steps
          items={[
            'Press the paperclip in the question box and choose the file: PDF (with text, not a scan), Word, Excel, CSV or text. Up to 5 files.',
            'Add your question, for example “Judge this plan. Is the budget realistic?” (or send without text and the council reviews the document).',
            'Choose Council for a plan or proposal, Quick for a summary or a check.',
          ]}
        />
        <Shot src="43-attach" caption="A plan attached to a council question." />
        <Tip>Only the text of the file is kept with the conversation, and it follows the same retention as your history. Don't attach customer lists; use the Collections tools for those.</Tip>
      </>
    ),
  },
  {
    id: 'templates-ask',
    title: 'Question templates and the script checker',
    who: 'Everyone',
    keywords: 'template starter new product collections vendor hiring policy sop script checker sms letter',
    body: (
      <>
        <P>Press <B>+ Templates</B> in the question box (or a card on the home screen). Each template asks for the facts the council needs, so it goes straight to work: new product launch, collections strategy change, vendor selection, hiring plan, draft a policy or SOP.</P>
        <Shot src="23-template-dialog" caption="A question template: fill what you know and press Ask the council." />
        <P><B>Check a customer script</B> reviews an SMS, WhatsApp, letter or call script for tone, clarity, fair treatment, lawful debt collection and PDPA, and gives a rewrite in English and BM.</P>
        <Shot src="24-script-check" caption="The script checker: verdict, issues and a rewrite." />
      </>
    ),
  },
  {
    id: 'draft',
    title: 'Draft documents and download Word',
    who: 'Everyone',
    keywords: 'draft sop policy letter memo word docx download',
    body: (
      <>
        <P>Under any answer press <B>Draft a document</B> and choose SOP, Policy, Customer letter or Staff memo. Anything you must confirm is marked <Code>[TO CONFIRM]</Code>. Press <B>Word</B> under any answer for an editable .docx.</P>
        <Shot src="29-draft-memo" caption="A staff memo drafted from a verdict." />
      </>
    ),
  },
  {
    id: 'action',
    title: 'Put a verdict into action (Action Crew)',
    who: 'Everyone',
    keywords: 'action crew tasks owners email approve dispatcher herald tracker runner board',
    body: (
      <>
        <Steps
          items={[
            'Under a council verdict press Put into action. In about a minute a plan is ready for you to check.',
            'Owners come from the staff directory by position; the AI never invents people. Change owners and dates as needed.',
            'Preview each email, tick Approve, and press Send approved. Nothing is sent before you approve.',
            'Follow progress on the task board; owners use the buttons in their email (Accept, Need help, Mark done).',
          ]}
        />
        <Shot src="09-launch" caption="The launch plan: tasks, owners, due dates and email preview." />
        <Shot src="11-tasks" caption="Tasks: work assigned to you, and the plans you started." />
      </>
    ),
  },
  {
    id: 'decisions',
    title: 'Decision register and company memory',
    who: 'Everyone',
    keywords: 'decision register outcome check-in meeting brief company memory lessons approved answers house rules suggest',
    body: (
      <>
        <P>Press <B>Record as decision</B> under a verdict you act on. After 30 and 60 days you're asked <i>did it work?</i>; record the outcome on the decision page. <B>Meeting brief</B> on the register writes a one-page summary for management.</P>
        <Shot src="30-decisions" caption="The decision register." />
        <H3>Company memory: the council gets smarter as you use it</H3>
        <Bullets
          items={[
            <><B>Lessons:</B> outcomes you record (worked / didn't work) are recalled when someone asks something similar.</>,
            <><B>Approved answers:</B> under a good answer press <B>Suggest as company answer</B>. Your department lead approves it, and the council reuses it for similar questions.</>,
            <><B>House rules:</B> short facts the council must always follow for a department (for example “NPL is 90 days past due; restructured loans are included”), set by leads.</>,
            <>When an answer used company memory, it says so under the answer (“Drew on company memory: 2 house rules, 1 past decision”).</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'tools',
    title: 'Tools: calculators and loan reports',
    who: 'Collections & Finance',
    keywords: 'tools calculator instalment rebate rule of 78 roll rates cost to collect arrears file portfolio npl par deduction reconciliation angkasa payslip affordability',
    body: (
      <>
        <P>Sidebar → <B>Tools</B>. Every tool has <B>Ask the council about this</B>, which puts the figures (never customer rows) into a new question.</P>
        <H3>Portfolio report (monthly NPL)</H3>
        <Steps
          items={[
            'Choose the month and upload the month-end loan export (.csv or .xlsx, one row per account, with a DPD column). Add last month\'s file for roll rates.',
            'Press Analyse: NPL ratio, PAR30/60/90, DPD buckets, and breakdowns by branch, product, employer and disbursement quarter, calculated exactly.',
            'Leads and admins: tick “Save as this month’s report” to build the month-by-month trend. Then Write council commentary, Download PDF report, or Email to Management.',
          ]}
        />
        <Shot src="46-portfolio" caption="Portfolio report for a month (synthetic data)." />
        <Tip>Figures are exact; the written commentary is an AI draft. Read it before sending. The NPL definition (days, restructured loans) is set in Admin → Settings.</Tip>
        <H3>Salary-deduction reconciliation</H3>
        <P>Upload your loans with their monthly instalment, and the deduction file from the employer or Angkasa. They are matched on account number, IC or salary number. You get every loan <B>not deducted</B>, <B>short</B> or <B>over</B>, and deductions with no matching loan, with a CSV to download.</P>
        <Shot src="47-deductions" caption="Reconciliation: exceptions with amounts." />
        <H3>Payslip affordability</H3>
        <P>Upload the <B>Payslip Extraction Result</B> report from the payslip extractor and enter the instalment (or amount, rate and tenure). The weakest month is checked against the deduction limit (60% of gross by default): <B>Affordable</B>, <B>Borderline</B> or <B>Not affordable</B>, with the largest instalment the rule allows and flags (existing financing, lines marked Not Match, fewer than 3 payslips). <B>Draft a credit memo</B> starts the memo for you.</P>
        <Shot src="48-affordability" caption="Affordability check on three months of payslips (synthetic)." />
        <H3>Calculators and arrears file</H3>
        <P>Instalment and EIR, early settlement rebate (Rule of 78 and straight-line), roll rates, cost to collect, and an arrears file analysis by DPD bucket, branch and product. Files are read in memory and not stored.</P>
      </>
    ),
  },
  {
    id: 'notis',
    title: 'Notis blast (missed salary deduction letters)',
    who: 'Collections & Finance',
    keywords: 'notis blast notice letter masterlist miss deduction email outlook draft angkasa collections',
    body: (
      <>
        <P>Sidebar → <B>Notis blast</B> (Collections staff and admins). Makes the monthly <i>Notis Potongan Gaji Tidak Berjaya</i> letter for every customer in the masterlist.</P>
        <Steps
          items={[
            'Download the month\'s masterlist from SharePoint and upload it as it is. The “MISS DEDUCTION EMAIL” sheet is read. Choose the date to print on the letters.',
            'Every row is checked. Rows with a remark from Finance (“remarks Ain”) are held; rows without a valid email or arrears months are skipped; amounts that don\'t add up, unreadable months, blank dates and shared emails are flagged under “Check first”.',
            'Click a tile to filter. Preview any letter, fix an email, or untick a customer.',
            'Press Download Outlook drafts. Extract the zip and double-click each file: Outlook opens it addressed, with the letter attached. Check it and press Send.',
          ]}
        />
        <Shot src="49-notis" caption="A notis batch (synthetic customers): summary tiles and the Outlook drafts button." />
        <Bullets
          items={[
            <>The zip also has <B>_Not sent - follow up.csv</B>: every customer not included and why.</>,
            <><B>Letters only (PDF zip)</B> gives just the letters, for printing or another channel.</>,
            <>Every download is recorded in the <B>send log</B>. Customer details are deleted from old batches after 90 days; the log is kept.</>,
            <>Sending directly from the Council (without Outlook) switches on when IT connects the Collections mailbox.</>,
          ]}
        />
        <Tip>Works with classic Outlook for Windows. If a draft opens read-only (new Outlook or Outlook on the web), use the letters zip.</Tip>
      </>
    ),
  },
  {
    id: 'doc-templates',
    title: 'Document templates (mail merge)',
    who: 'Everyone',
    keywords: 'document templates mail merge word docx tags customername mapping columns spreadsheet letters reminders outlook drafts',
    body: (
      <>
        <P>Sidebar → <B>Doc templates</B>. Turn a Word document with <Code>{'{{tags}}'}</Code> into one document per spreadsheet row: reminder letters, confirmations, certificates, anything.</P>
        <H3>1. Make the template</H3>
        <P>In Word, type tags where the data goes, for example <Code>{'{{customername}}'}</Code>, <Code>{'{{amount}}'}</Code>, <Code>{'{{date}}'}</Code>, and save as .docx. Upload it with a name. Or, without Word: open the <B>Template</B> tab, select the sample text in the preview (such as a name), give the tag a name and press <B>Make tag</B>. The formatting is kept.</P>
        <Shot src="52-templates-tag" caption="Selecting “Puan Aminah” in the preview to turn it into {{officer}}." />
        <H3>2. Upload the data and match the tags</H3>
        <P>On <B>Data &amp; mapping</B>, upload the spreadsheet (.xlsx or .csv). Tags are matched to columns by name (<Code>{'{{customername}}'}</Code> → “Customer Name”). For the rest press <B>Suggest the rest with AI</B> (it sees only the column names), or choose yourself. Pick a format per tag (RM amounts, Malay or English dates, IC, Malay months, capitals), a fixed text, or the batch date. The example column shows the first row's value.</P>
        <Shot src="50-templates-mapping" caption="Each tag matched to a column, with its format and an example." />
        <Bullets
          items={[
            <><B>Conditions</B> choose which rows get a document, e.g. “remarks Ain is blank”, “Overdue month is at least 2”.</>,
            <><B>File name</B> can use tags, e.g. <Code>{'Peringatan_{{customername}}_{{account_no}}'}</Code>.</>,
            <>Press <B>Save changes</B>. Next month just upload the new spreadsheet: the mapping is kept.</>,
          ]}
        />
        <H3>3. Email (optional) and 4. Generate</H3>
        <P>On <B>Email</B>, choose the email column and write the subject and message, using the same tags. On <B>Generate</B>, check the rows (blank tags and bad emails are flagged), untick any you don't want, then <B>Download Word documents</B> or <B>Download Outlook drafts</B>.</P>
        <Shot src="51-templates-generate" caption="Generate: the rows, what each tag becomes, and the downloads." />
        <Tip>Values are filled straight from your spreadsheet, not written by the AI, so a batch takes seconds and every amount is exactly what's in the file. Templates are shared with your department; tick Company-wide to share with everyone.</Tip>
      </>
    ),
  },
  {
    id: 'phone',
    title: 'Telegram, voice and notifications',
    who: 'Everyone',
    keywords: 'telegram bot voice microphone speak notifications bell',
    body: (
      <>
        <Bullets
          items={[
            <><B>Voice:</B> press the microphone, speak in English or BM, press again to stop, check the text and send. Transcribed on our own server; the recording isn't kept.</>,
            <><B>Telegram:</B> sidebar → Telegram → Connect, then press Start in the bot. Ask from your phone; use /quick, /council, /new. Never send customer personal data through Telegram.</>,
            <><B>The bell:</B> verdicts ready, task updates, overdue nudges, decision check-ins, documents due for review, setup reminders.</>,
          ]}
        />
        <Shot src="12-notifications" caption="Notifications." />
      </>
    ),
  },
  {
    id: 'leads',
    title: 'For department leads',
    who: 'Department leads',
    keywords: 'department lead onboarding setup checklist knowledge house rules review answers digest',
    body: (
      <>
        <P>Leads get a <B>setup checklist</B> on the home screen that ticks itself off as you do each step, with reminders until it is done:</P>
        <Steps
          items={[
            'Add at least 3 house rules for your department (Admin → Company memory).',
            'Upload at least one SOP or policy (Admin → Knowledge).',
            'Clear your department\'s suggested-answers queue: approve (edit first if needed) or reject.',
            'Ask your first council question.',
            'Record a decision in the register.',
          ]}
        />
        <Shot src="44-memory" caption="Admin → Company memory: house rules, suggested answers to review, approved answers." />
        <Bullets
          items={[
            <><B>Knowledge:</B> upload department documents and keep them current; you're notified when one is due for review.</>,
            <><B>Weekly digest:</B> every Monday, an email with your department's questions, decisions, outcomes, overdue tasks and documents to review (counts only, never what anyone asked).</>,
            <><B>Portfolio reports:</B> leads of Finance, Collections and Management are reminded monthly to upload the loan export, and can save the month and email the report.</>,
            <><B>Sending to customers:</B> direct sending (when connected) needs a lead or admin.</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'admins',
    title: 'For admins',
    who: 'Admins',
    keywords: 'admin users roles invite departments prompts models settings audit staff directory crew email outbox retention',
    body: (
      <>
        <Bullets
          items={[
            <><B>Users:</B> add users, set the role (Employee, Department lead, Admin), resend invites. Setting someone as Department lead starts their setup checklist.</>,
            <><B>Settings:</B> who can use Council mode, retention, clarifying questions, weekly digest, compliance-seat departments, and the loan tools: NPL definition, report recipients, affordability limits, notis hold column and how long customer details are kept.</>,
            <><B>Company memory:</B> house rules for any department, all suggested answers, the monthly improvement report.</>,
            <><B>Staff directory, Action Crew &amp; email, Knowledge, Personas &amp; prompts, Model routing, Audit log.</B></>,
          ]}
        />
        <P>The AI model is <B>Qwen 2.5 (14B)</B> running on Xanderia's own GPU server; nothing is sent to outside AI services. The full admin manual is in the PDF guide.</P>
      </>
    ),
  },
  {
    id: 'privacy',
    title: 'Privacy, safety and good answers',
    who: 'Everyone',
    keywords: 'privacy pdpa on-premises personal data audit delete history retention tips faq',
    body: (
      <>
        <Bullets
          items={[
            <><B>On-premises:</B> questions, documents and verdicts stay on Xanderia's servers.</>,
            <><B>Personal data:</B> don't paste IC or account numbers unless you need to. Customer files in the Collections tools are read in memory; only totals reach the AI.</>,
            <><B>Your history:</B> delete a conversation, or all of them, any time. Old conversations are deleted automatically after the retention period.</>,
            <><B>Audit log:</B> sign-ins, model calls, downloads and emails are logged and can't be edited.</>,
            <><B>Red flags:</B> requests that look like harassment, fraud, data misuse or discrimination are flagged to Compliance.</>,
          ]}
        />
        <H3>Getting good answers</H3>
        <Bullets items={['Give the numbers: amounts, volumes, headcount, budget, deadlines.', 'Say what decision you face (“Should we … or …?”).', 'Use Council for trade-offs, Quick for facts and how-tos.', 'Challenge the verdict: answer its open questions, or ask What if….']} />
      </>
    ),
  },
];

/** Which guide section a page's ? button opens. */
export function guideSectionFor(path: string): string {
  if (path.startsWith('/tools')) return 'tools';
  if (path.startsWith('/notis')) return 'notis';
  if (path.startsWith('/templates')) return 'doc-templates';
  if (path.startsWith('/decisions')) return 'decisions';
  if (path.startsWith('/tasks') || path.startsWith('/plans')) return 'action';
  if (path.startsWith('/admin/memory')) return 'leads';
  if (path.startsWith('/admin')) return 'admins';
  return 'start';
}

export default function GuidePage() {
  const { hash } = useLocation();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return SECTIONS;
    return SECTIONS.filter((s) => words.every((w) => `${s.title} ${s.keywords} ${s.who}`.toLowerCase().includes(w)));
  }, [q]);
  useEffect(() => {
    const id = hash.replace('#', '');
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50);
  }, [hash]);

  return (
    <Shell
      title={tl('User guide')}
      right={
        <a href={PDF} download className="hidden items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 sm:inline-flex">
          <Icon name="download" className="h-3.5 w-3.5" /> {tl('Full guide (PDF)')}
        </a>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <nav className="lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
          <input className="mb-3 w-full rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm" placeholder={tl('Search the guide…')} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="space-y-0.5">
            {shown.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={cx('block rounded-md px-2 py-1 text-sm hover:bg-ink-100', hash === `#${s.id}` ? 'bg-ink-100 font-medium text-ink-900' : 'text-ink-600')}>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
          <a href={PDF} download className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent-700 hover:underline sm:hidden">
            <Icon name="download" className="h-3.5 w-3.5" /> {tl('Full guide (PDF)')}
          </a>
          {getLangNote()}
        </nav>
        <div className="min-w-0 space-y-6">
          {shown.length === 0 && <p className="text-sm text-ink-500">{tl('Nothing matches. Try another word.')}</p>}
          {shown.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-4 rounded-xl border border-ink-100 bg-white p-5 shadow-sm md:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink-900">{s.title}</h2>
                <span className="rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-medium text-ink-500">{s.who}</span>
              </div>
              {s.body}
            </section>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function getLangNote() {
  return <p className="mt-4 text-xs text-ink-400">{tl('The guide is in English. The app itself can be switched to BM with EN / BM.')}</p>;
}
