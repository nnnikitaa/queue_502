(() => {
  const config = window.APP_CONFIG || {};
  const form = document.querySelector('#joinForm');
  const surnameInput = document.querySelector('#surname');
  const teacherSelect = document.querySelector('#teacher');
  const message = document.querySelector('#message');
  const template = document.querySelector('#personTemplate');
  const submitButton = form.querySelector('button[type="submit"]');

  const STORAGE_KEY = 'teacherQueueOwnershipV1';

  function showMessage(text, type = '') {
    message.textContent = text;
    message.className = `message ${type}`.trim();
  }

  function getOwnership() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveOwnership(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function addOwnership(id, token) {
    const ownership = getOwnership();
    ownership[String(id)] = token;
    saveOwnership(ownership);
  }

  function removeOwnership(id) {
    const ownership = getOwnership();
    delete ownership[String(id)];
    saveOwnership(ownership);
  }

  function createOwnerToken() {
    if (crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  const configured =
    config.SUPABASE_URL &&
    config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_URL.includes('PASTE_') &&
    !config.SUPABASE_ANON_KEY.includes('PASTE_');

  if (!configured) {
    showMessage('Сначала заполните SUPABASE_URL и SUPABASE_ANON_KEY в файле config.js', 'error');
    form.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return;
  }

  const client = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );

  async function callRpc(name, params = {}) {
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  }

  function cleanError(error) {
    const text = error?.message || String(error || 'Неизвестная ошибка');

    if (text.includes('surname_already_exists')) {
      return 'Эта фамилия уже есть в очереди к выбранному преподавателю';
    }
    if (text.includes('invalid_surname')) {
      return 'Введите фамилию';
    }
    if (text.includes('invalid_teacher')) {
      return 'Выберите преподавателя';
    }
    if (text.includes('not_owner')) {
      return 'Этой записью можно управлять только с устройства, с которого она была создана';
    }
    return text;
  }

  function renderQueue(teacherId, rows) {
    const host = document.querySelector(`#queue${teacherId}`);
    const empty = document.querySelector(`#empty${teacherId}`);
    const count = document.querySelector(`#count${teacherId}`);
    const ownership = getOwnership();

    host.innerHTML = '';
    count.textContent = String(rows.length);
    empty.hidden = rows.length > 0;

    rows.forEach((row, index) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector('.person-row');
      const actions = fragment.querySelector('.actions');
      const ownToken = ownership[String(row.id)];
      const isOwn = Boolean(ownToken);

      fragment.querySelector('.position').textContent = String(index + 1);
      fragment.querySelector('.surname').textContent = row.surname;

      if (isOwn) {
        card.classList.add('is-own');
      } else {
        actions.hidden = true;
      }

      fragment.querySelector('.move-btn').addEventListener('click', async () => {
        try {
          await callRpc('move_to_end', {
            p_id: Number(row.id),
            p_owner_token: ownToken
          });
          showMessage('Вы перенесены в конец очереди', 'success');
          await loadQueues();
        } catch (error) {
          showMessage(cleanError(error), 'error');
        }
      });

      fragment.querySelector('.done-btn').addEventListener('click', async () => {
        try {
          await callRpc('mark_done', {
            p_id: Number(row.id),
            p_owner_token: ownToken
          });
          removeOwnership(row.id);
          showMessage(`${row.surname}: отмечено как «ответил»`, 'success');
          await loadQueues();
        } catch (error) {
          showMessage(cleanError(error), 'error');
        }
      });

      host.appendChild(fragment);
    });
  }

  async function loadQueues() {
    try {
      const rows = await callRpc('get_queue');
      const queue1 = (rows || []).filter(row => Number(row.teacher) === 1);
      const queue2 = (rows || []).filter(row => Number(row.teacher) === 2);

      renderQueue('1', queue1);
      renderQueue('2', queue2);
    } catch (error) {
      showMessage(`Не удалось загрузить очередь: ${cleanError(error)}`, 'error');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const surname = surnameInput.value.trim();
    const teacher = Number(teacherSelect.value);

    if (!surname) {
      showMessage('Введите фамилию', 'error');
      return;
    }

    const ownerToken = createOwnerToken();
    submitButton.disabled = true;

    try {
      const result = await callRpc('join_queue', {
        p_surname: surname,
        p_teacher: teacher,
        p_owner_token: ownerToken
      });

      const id = Array.isArray(result) ? result[0]?.id : result?.id;
      if (!id) {
        throw new Error('Сервер не вернул ID записи');
      }

      addOwnership(id, ownerToken);
      surnameInput.value = '';
      surnameInput.focus();

      showMessage(`${surname}: вы добавлены в очередь`, 'success');
      await loadQueues();
    } catch (error) {
      showMessage(cleanError(error), 'error');
    } finally {
      submitButton.disabled = false;
    }
  });

  loadQueues();
  setInterval(loadQueues, 3000);
})();
