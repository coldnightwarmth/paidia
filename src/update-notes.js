export const isTagField = name => /^(tags?|categor(y|ies)|themes?|lists?|types?)$/i.test(name);
export function tagValues(value) {
  if (Array.isArray(value)) return value.flatMap(tagValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(tagValues);
  return String(value ?? '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
}
function containsAll(next, previous) {
  const remaining = [...next];
  return previous.every(value => {
    const index = remaining.indexOf(value);
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}
export function describeChanges(previous, next) {
  if (!previous) return ['Page Created'];
  const notes = [];
  if (previous.title !== next.title) notes.push('Title Edited');
  if (JSON.stringify(previous.tags) !== JSON.stringify(next.tags)) {
    notes.push(containsAll(next.tags, previous.tags) ? 'Tags Added' : 'Tags Edited');
  }
  if (JSON.stringify(previous.content) !== JSON.stringify(next.content)) {
    notes.push(containsAll(next.content, previous.content) ? 'Content Added' : 'Content Modified');
  }
  if (previous.details !== next.details) notes.push('Details Edited');
  return notes.length ? notes : ['Page Updated'];
}
export function rowSnapshot(row, columns = []) {
  const tags = [];
  const content = [];
  row.forEach((value, index) => {
    if (isTagField(columns[index] ?? '')) tags.push(...tagValues(value));
    else if (index > 0 && value !== '' && value != null) content.push(JSON.stringify([columns[index] ?? index, value]));
  });
  return { title: row[0], tags: [...new Set(tags)].sort(), content, details: '' };
}
