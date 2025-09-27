const feed = document.getElementById("message-feed");
const counter = document.getElementById("message-count");
const form = document.getElementById("composer-form");
const template = document.getElementById("message-template");

async function fetchMessages() {
  const response = await fetch("/api/messages");
  if (!response.ok) {
    throw new Error("메세지를 불러오지 못했습니다.");
  }
  return response.json();
}

function formatTimestamp(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderEmptyState() {
  feed.innerHTML = `<p class="empty-state">아직 등록된 문자가 없습니다. 첫 번째 메세지를 남겨보세요!</p>`;
  counter.textContent = "0";
}

function renderMessages(messages) {
  if (!messages.length) {
    renderEmptyState();
    return;
  }

  feed.innerHTML = "";
  counter.textContent = messages.length.toString();

  messages.forEach((message) => {
    const instance = template.content.cloneNode(true);
    instance.querySelector(".message").dataset.id = message.id;
    instance.querySelector(".message__author").textContent = message.author;
    instance.querySelector(".message__timestamp").textContent = formatTimestamp(message.created_at);
    instance.querySelector(".message__body").textContent = message.body;
    feed.appendChild(instance);
  });
}

async function loadMessages() {
  try {
    const messages = await fetchMessages();
    renderMessages(messages);
  } catch (error) {
    console.error(error);
    feed.innerHTML = `<p class="empty-state">메세지를 불러오는 중 오류가 발생했습니다.</p>`;
  }
}

async function submitMessage(event) {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = data?.detail ?? "메세지를 전송할 수 없습니다.";
      throw new Error(message);
    }

    form.reset();
    await loadMessages();
  } catch (error) {
    alert(error.message);
  }
}

async function handleDelete(event) {
  const button = event.target.closest(".message__delete");
  if (!button) return;

  const message = button.closest(".message");
  const id = message?.dataset?.id;
  if (!id) return;

  const confirmed = confirm("이 문자를 삭제할까요?");
  if (!confirmed) return;

  const response = await fetch(`/api/messages/${id}`, { method: "DELETE" });
  if (!response.ok) {
    alert("메세지를 삭제할 수 없습니다.");
    return;
  }

  message.remove();
  const remaining = feed.querySelectorAll(".message").length;
  counter.textContent = remaining.toString();
  if (!remaining) {
    renderEmptyState();
  }
}

form.addEventListener("submit", submitMessage);
feed.addEventListener("click", handleDelete);

loadMessages();
