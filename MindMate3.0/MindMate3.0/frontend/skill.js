document.getElementById('assessmentForm').addEventListener('submit', function(event) {
  event.preventDefault();

  if (!this.checkValidity()) {
    this.classList.add('was-validated');
    return;
  }

  const formData = new FormData(this);
  let totalScore = 0;

  for (let [key, value] of formData.entries()) {
    totalScore += parseInt(value, 10);
  }

  let level = '';
  let message = '';

  if (totalScore <= 20) {
    level = 'Starter';
    message = 'You have foundational skills. Keep building and practicing!';
  } else if (totalScore <= 33) {
    level = 'Skilled';
    message = 'Good job! You have solid skills and potential to grow further.';
  } else {
    level = 'Proficient';
    message = 'Excellent! You demonstrate strong skills and confidence.';
  }

  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = `<p>Your Skill Level: <span class="text-primary">${level}</span></p><p>${message}</p>`;

});
