import axios, * as others from 'axios';
import * as core from '@actions/core';
import * as github from '@actions/github';

const { context = {} } = github;
const { pull_request } = context.payload;
const regexPullRequest = /Merge pull request \#\d+ from/g;
const trelloApiKey = core.getInput('trello-api-key', { required: true });
const trelloAuthToken = core.getInput('trello-auth-token', { required: true });
const trelloBoardId = core.getInput('trello-board-id', { required: true });
const trelloCardAction = core.getInput('trello-card-action', { required: true });
const trelloListNamePullRequestOpen = core.getInput('trello-list-name-pr-open', { required: false });
const trelloListNamePullRequestClosed = core.getInput('trello-list-name-pr-closed', { required: false });
const trelloDebugMode = core.getInput('trello-debug-mode', { required: false }) || "false";


function getCardHash(message) {
  log(`getCardHash(${message})`);
  let ids = message && message.length > 0 ? message.replace(regexPullRequest, "").match(/\[t[:-](\w+)]/) : [];
  return ids
}


function getCardId(cardsFromBoard, cardHash){
  // log(`getCardId(${JSON.stringify(cardsFromBoard)}, ${cardHash})`);
  const cardId = cardsFromBoard.find(card => card["shortLink"] === cardHash);   
  return cardId ? cardId.id : null;
}


async function getCardIdFromBoard(trelloBoardId, cardHash){
  log(`getCardIdFromBoard(${trelloBoardId}, ${cardHash})`);
  if (trelloBoardId && cardHash) {
    let url = `https://trello.com/1/boards/${trelloBoardId}/cards`;
    return await axios.get(url, { 
      params: { 
        key: trelloApiKey, 
        token: trelloAuthToken 
      }
    }).then(response => {
      return getCardId(response.data, cardHash);
    }).catch(error => {
      console.error(url, `Error_getCardIdFromBoard ${error}`);
      return null;
    });
  }
  return null;
}

async function getAllCardNumbers(message_title) {
  const cardMessageTitle = getCardHash(message_title);
  if (cardMessageTitle == null) {
    throw new Error("PR title or branch name does not meet the guidelines");
  }
  if (cardMessageTitle.length > 2)
      throw new Error("PR title has more than one card, name does not meet the guidelines");

  let cardHash = cardMessageTitle[1];
  let cardId = await getCardIdFromBoard(trelloBoardId, cardHash);
  return new Set([cardId]);
}

async function getCardOnBoard(board, card) {
  log(`getCardOnBoard(${board}, ${card})`);
  if (card && card.length > 0) {
    let url = `https://trello.com/1/boards/${board}/cards/${card}`;
    return await axios.get(url, { 
      params: { 
        key: trelloApiKey, 
        token: trelloAuthToken 
      }
    }).then(response => {
      return response.data.id;
    }).catch(error => {
      console.error(url, `Error_getCardOnBoard ${error}`);
      return null;
    });
  }

  return null;
}

async function getListOnBoard(board, list) {
  log(`getListOnBoard(${board}, ${list})`);
  let url = `https://trello.com/1/boards/${board}/lists`
  return await axios.get(url, { 
    params: { 
      key: trelloApiKey, 
      token: trelloAuthToken 
    }
  }).then(response => {
    let result = response.data.find(l => l.closed == false && l.name == list);
    return result ? result.id : null;
  }).catch(error => {
    console.error(url, `Error ${error.response.status} ${error.response.statusText}`);
    return null;
  });
}

async function addAttachmentToCard(card, link) {
  log(`addAttachmentToCard(${card}, ${link})`);
  let url = `https://api.trello.com/1/cards/${card}/attachments`;
  return await axios.post(url, {
    key: trelloApiKey,
    token: trelloAuthToken, 
    url: link
  }).then(response => {
    return response.status == 200;
  }).catch(error => {
    console.error(url, `Error ${error.response.status} ${error.response.statusText}`);
    return null;
  });
}

async function addCommentToCard(card, user, message, link) {
  log(`addCommentToCard(${card}, ${user}, ${message}, ${link})`);
  let url = `https://api.trello.com/1/cards/${card}/actions/comments`;
  return await axios.post(url, {
    key: trelloApiKey,
    token: trelloAuthToken, 
    text: `${user}: ${message} ${link}`
  }).then(response => {
    return response.status == 200;
  }).catch(error => {
    console.error(url, `Error ${error.response.status} ${error.response.statusText}`);
    return null;
  });
}

async function moveCardToList(board, card, list) {
  log(`moveCardToList(${board}, ${card}, ${list})`);
  let listId = await getListOnBoard(board, list);
  if (listId && listId.length > 0) {
    let url = `https://api.trello.com/1/cards/${card}`;
    return await axios.put(url, {
      key: trelloApiKey,
      token: trelloAuthToken, 
      idList: listId
    }).then(response => {
      return response && response.status == 200;
    }).catch(error => {
      console.error(url, `Error ${error.response.status} ${error.response.statusText}`);
      return null;
    });
  }       
  return null;
}

async function handlePullRequest(data) {
  // log(`handlePullRequest`, data);
  let url = data.html_url || data.url;
  let message_title = data.title;
  let user = data.user.name;
  //let branch = data.head.ref;
  let cardsNumbers = await getAllCardNumbers(message_title);

  cardsNumbers.forEach(async cardNumber => {

  let card = await getCardOnBoard(trelloBoardId, cardNumber);
    if (card && card.length > 0) {
      if (trelloCardAction && trelloCardAction.toLowerCase() == 'attachment') {
        await addAttachmentToCard(card, url);
      }
      else if (trelloCardAction && trelloCardAction.toLowerCase() == 'comment') {
        await addCommentToCard(card, user, message_title, url);
      }
      if (data.state == "open" && trelloListNamePullRequestOpen && trelloListNamePullRequestOpen.length > 0) {
        await moveCardToList(trelloBoardId, card, trelloListNamePullRequestOpen);
      }
      else if (data.state == "closed" && trelloListNamePullRequestClosed && trelloListNamePullRequestClosed.length > 0) {
        await moveCardToList(trelloBoardId, card, trelloListNamePullRequestClosed);
      }
    }
  });
}

function log(text, args){
  if (trelloDebugMode.toLowerCase() === 'true')
      console.log(text, args);
}

async function run() {
  if (pull_request && pull_request.title) {
    handlePullRequest(pull_request)
  }
};

run()