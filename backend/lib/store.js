const crypto = require("crypto");

/*
  Keeps uploaded documents in the server's memory so the tutor can search them later.
  Everything here is lost when the server restarts. A database replaces this in a later phase.
*/
const MAX_DOCUMENTS = 50;
const documents = new Map();

// Saves the pieces of a document and returns the id the frontend uses to refer to it.
function saveDocument(pieces) {
  // A Map remembers insertion order, so the first key is the oldest document
  if (documents.size >= MAX_DOCUMENTS) {
    documents.delete(documents.keys().next().value);
  }

  const id = crypto.randomUUID();
  documents.set(id, { pieces });
  return id;
}

function getDocument(id) {
  return documents.get(id) || null;
}

module.exports = { saveDocument, getDocument, MAX_DOCUMENTS };
