(() => {
  const config = window.APP_CONFIG || {};
  const form = document.querySelector('#joinForm');
  const surnameInput = document.querySelector('#surname');
  const teacherSelect = document.querySelector('#teacher');
  const message = document.querySelector('#message');
  const template = document.querySelector('#personTemplate');
  const submitButton = form.querySelector('button[type="submit"]');

  function showMessage(text, type = '') {
    message.textContent = text;
    message.className = `message ${type}`.trim();
  }

  const configured =
    config.SUPABASE_URL &&
    config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_URL.includes('PASTE_') &&
    !config.SUPABASE_ANON_KEY.includes('PASTE_');

  if (!configured) {
    showMessage('Не заполнены настройки Supabase в config.js', 'error');
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

  async function rpc(name, params = {}) {
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  }

  function friendlyError(error) {
    const text = error?.message || String(error || 'Неизвестная ошибка');

    if (text.includes('surname_already_exists')) {
      return 'Эта фамилия уже есть в очереди к выбранному преподавателю';
    }
    if (text.includes('invalid_surname')) return 'Введите фамилию';
    if (text.includes('invalid_teacher')) return 'Выберите преподавателя';
    if (text.includes('row_not_found')) return 'Запись уже изменена или удалена другим пользователем';

    return text;
  }

  function renderQueue(teacherId, rows) {
    const host = document.querySelector(`#queue${teacherId}`);
    const empty = document.querySelector(`#empty${teacherId}`);
    const count = document.querySelector(`#count${teacherId}`);

    host.innerHTML = '';
    count.textContent = String(rows.length);
    empty.hidden = rows.length > 0;

    rows.forEach((row, index) => {
      const fragment = template.content.cloneNode(true);

      fragment.querySelector('.position').textContent = String(index + 1);
      fragment.querySelector('.surname').textContent = row.surname;

      // ВАЖНО: действия доступны ВСЕМ пользователям для ЛЮБОЙ записи.
      fragment.querySelector('.move-btn').addEventListener('click', async () => {
        try {
          await rpc('queue_move_v3', { p_id: Number(row.id) });
          showMessage(`${row.surname}: перенесён в конец очереди`, 'success');
          await loadQueues();
        } catch (error) {
          showMessage(friendlyError(error), 'error');
        }
      });

      fragment.querySelector('.done-btn').addEventListener('click', async () => {
        try {
          await rpc('queue_done_v3', { p_id: Number(row.id) });
          showMessage(`${row.surname}: удалён из очереди`, 'success');
          await loadQueues();
        } catch (error) {
          showMessage(friendlyError(error), 'error');
        }
      });

      host.appendChild(fragment);
    });
  }

  async function loadQueues() {
    try {
      const rows = await rpc('queue_get_v3');
      renderQueue('1', (rows || []).filter(row => Number(row.teacher) === 1));
      renderQueue('2', (rows || []).filter(row => Number(row.teacher) === 2));
    } catch (error) {
      showMessage(`Не удалось загрузить очередь: ${friendlyError(error)}`, 'error');
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

    submitButton.disabled = true;

    try {
      await rpc('queue_join_v3', {
        p_surname: surname,
        p_teacher: teacher
      });

      surnameInput.value = '';
      surnameInput.focus();
      showMessage(`${surname}: добавлен в очередь`, 'success');
      await loadQueues();
    } catch (error) {
      showMessage(friendlyError(error), 'error');
    } finally {
      submitButton.disabled = false;
    }
  });

  loadQueues();
  setInterval(loadQueues, 2500);
})();
