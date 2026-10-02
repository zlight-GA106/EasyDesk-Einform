export function createLocationPicker({ api, escape: esc }) {
  const panel = (loc, nameField = 'name') => `<div class="full geo-picker" data-location-picker data-name-field="${nameField}"><div class="geo-search"><label>和风天气区县查询<input data-geo-query type="text" maxlength="100" placeholder="区县名称或经度,纬度" data-independent></label><label>所属城市（可选）<input data-geo-adm type="text" maxlength="64" placeholder="例如：上海" data-independent></label><button type="button" data-geo-search data-independent>查询区县</button></div><p class="muted">保存 API Host / Key 后可查询并选择区县，自动填入名称和坐标。也可手动填写地区。</p><div data-geo-results></div>${['id', 'district', 'city', 'province'].map(k => `<input type="hidden" name="geo-${k}" value="${esc(loc[k] || '')}">`).join('')}<label>区县名称（手动设置）<input name="district" value="${esc(loc.district || '')}" maxlength="64" placeholder="例如：浦东新区" data-independent></label></div>`;
  const read = (fields, nameField = 'name') => ({ name: fields[nameField], latitude: Number(fields.latitude), longitude: Number(fields.longitude), ...Object.fromEntries(['id', 'city', 'province'].filter(k => fields[`geo-${k}`]).map(k => [k, fields[`geo-${k}`]])), ...(fields.district ? { district: fields.district } : {}) });
  async function click(button) {
    const picker = button.closest('[data-location-picker]'); if (!picker) return false;
    if (button.hasAttribute('data-geo-search')) {
      const results = await api('weather/lookup', 'POST', { query: picker.querySelector('[data-geo-query]').value, adm: picker.querySelector('[data-geo-adm]').value });
      picker.querySelector('[data-geo-results]').innerHTML = results.length ? results.map(loc => `<button type="button" class="geo-result" data-geo-select="${esc(JSON.stringify(loc))}">${esc(loc.name)} · ${loc.district ? '区县' : '仅城市，请继续查询区县'} · ${loc.latitude}, ${loc.longitude}</button>`).join('') : '<p class="muted">未找到地区，请补充所属城市或更换关键词。</p>';
      return true;
    }
    if (button.dataset.geoSelect) {
      const loc = JSON.parse(button.dataset.geoSelect), form = picker.closest('form');
      form.elements[picker.dataset.nameField].value = loc.name; form.elements.latitude.value = loc.latitude; form.elements.longitude.value = loc.longitude;
      for (const k of ['id', 'district', 'city', 'province']) form.elements[`geo-${k}`].value = loc[k] || '';
      form.elements.district.value = loc.district || ''; picker.querySelector('[data-geo-results]').innerHTML = `<p class="muted">已选择：${esc(loc.name)}。保存配置或生成 PNG 后生效。</p>`; return true;
    }
    return false;
  }
  function change(input) {
    const form = input.form, picker = form?.querySelector('[data-location-picker]'); if (!picker) return;
    if ([picker.dataset.nameField, 'latitude', 'longitude', 'district'].includes(input.name)) for (const k of ['id', 'city', 'province']) form.elements[`geo-${k}`].value = '';
    if (['latitude', 'longitude'].includes(input.name)) form.elements.district.value = '';
  }
  return { panel, read, click, change };
}
