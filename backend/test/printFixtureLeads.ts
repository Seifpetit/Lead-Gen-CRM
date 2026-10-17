// Prints the fixture pipeline's leads as Markdown, for reviewing the scoring by eye.
import { runFixturePipeline } from './fixturePipeline.js';

const { qualifications, leads } = await runFixturePipeline();
const out: string[] = ['# Fixture leads (synthetic data)', '', '## Qualification', ''];
out.push('| Company | Verdict | How | Reason |', '| --- | --- | --- | --- |');
for (const { name, q } of qualifications) {
  out.push(`| ${name} | ${q.verdict} | ${q.method} (${q.kind}) | ${q.reasons.join('; ')} |`);
}
out.push('', '## Scored leads', '');
for (const { candidate: c, score: s } of leads) {
  const who = c.person
    ? `${c.person.fullName.value}, ${c.person.title?.value ?? '?'} (${c.person.roleClass})`
    : 'company only';
  out.push(`### ${c.company.name.value}: ${who}`, '');
  out.push(
    `Total **${s.total}** = company ${s.companyFit}/50 + contact ${s.contactFit}/30 + reachability ${s.reachability}/20 (fact ${s.factPoints}, estimate ${s.estimatePoints})`,
    '',
  );
  const ch = (x: typeof c.channel) =>
    x
      ? `${x.type} ${x.value.value} (${x.quality}${x.emailStatus ? `, ${x.emailStatus}` : ''})`
      : 'none';
  out.push(`- Channel: ${ch(c.channel)}`, `- Company fallback: ${ch(c.companyChannel)}`);
  for (const sk of c.skipped) out.push(`- Skipped ${sk.name}: ${sk.reason}`);
  out.push('', '| Points | Component | Kind | Reason |', '| --- | --- | --- | --- |');
  for (const p of s.points) out.push(`| ${p.points} | ${p.component} | ${p.kind} | ${p.reason} |`);
  out.push('');
}
console.log(out.join('\n'));
