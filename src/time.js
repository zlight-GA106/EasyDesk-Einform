export function dateParts(date = new Date(), timezone = 'Asia/Shanghai') {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return { ...values, date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}
