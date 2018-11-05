import express from 'express'
import expressWs from 'express-ws'
import Linker from './logic/linker'

const router = express.Router()
//doing this is a hack for detached routers...
expressWs(router)

const CLIENT_TOKEN_COOKIE = "ct"

const getClientToken = req => {
  return req.cookies[CLIENT_TOKEN_COOKIE]
}

const clientTokenHandler = (res, clientToken) => {
  if (clientToken) {
    res.cookie(CLIENT_TOKEN_COOKIE, clientToken, {expires:new Date(Date.now() + 15 * 24 * 3600 * 1000), httpOnly:true})
  }
}

const linker = new Linker()

router.post("/generate-code", async (req, res) => {
  const clientToken = getClientToken(req)
  const {return_url, session_token, pending_call} = req.body
  const {outClientToken, sessionToken, linkCode, linked} = await linker.generateCode(clientToken, session_token, req.useragent, return_url, pending_call)
  clientTokenHandler(res, outClientToken)
  res.send({session_token:sessionToken, link_code:linkCode, linked})
})

router.get("/link-info/:code", async (req, res) => {
  const {code} = req.parameters
  // this is the context
  const {appInfo, linkId} = await linker.getLinkInfo(code)
  res.send({app_info:appInfo, link_id:linkId})
})

router.post("/call-wallet/:sessionToken", async (req, res) => {
  const clientToken = getClientToken(req)
  const {sessionToken} = req.parameters
  const {account, call_id, call, return_url} = req.body
  const success = await linker.callWallet(clientToken, sessionToken, account, call_id, call, return_url)
  res.send({success})
})

router.post("/wallet-called/:walletToken", async (req, res) => {
  const {walletToken} = req.parameters
  const {call_id, link_id, session_token, result} = req.body
  const success = await linker.walletCalled(walletToken, call_id, link_id, session_token, result)
  res.send({success})
})

router.post("/link-wallet/:walletToken", async (req, res) => {
  const {walletToken} = req.parameters
  const {code, current_rpc, current_accounts} = req.body
  const {linked, pendingCallContext, appInfo, linkId, linkedAt} 
    = await linker.linkWallet(wallet_token, code, current_rpc, current_accounts)

  res.send({linked, pending_call_context:pendingCallContext, 
    app_info:appInfo, link_id:linkId, linked_at:linkedAt})
})

router.get("/wallet-links/:walletToken", async (req, res) => {
  const {walletToken} = req.parameters
  const links = await linker.getWalletLinks(walletToken)
    .map(({linked, appInfo, linkId, linkedAt}) => ({linked, app_info:appInfo, link_id:link_id, linked_at:linkedAt}))
  res.send(links)
})

router.post("/unlink", async (req, res) => {
  const clientToken = getClientToken(req)
  const success = await unlink(clientToken)
  res.send(success)
})

router.post("/unlink-wallet/:walletToken", async (req, res) => {
  const {walletToken} = req.parameters
  const {link_id} = req.body
  const success = await linker.unlinkWallet(walletToken, link_id)
  res.send(success)
})

router.ws("/linked-messages/:sessionToken/:readId", async (ws, req) => {
  const client_token = getClientToken(req)
  const {sessionToken, readId} = req.parameters

  //this prequeues some messages before establishing the connection
  const closeHandler = await linker.handleSessionMessages(sessionToken, lastReadId, (msg, msgId) =>
    {
      ws.send({msg, msgId})
    })

  ws.on("close", () => {
    closeHandler()
  })

})

router.ws("/wallet-messages/:walletToken/:readId", (ws, req) => {
  const {walletToken, readId} = req.parameters

  if (!walletToken) {
    ws.close()
  }

  const closeHandler = linker.handleMessages(walletToken, readId, (msg, msgId) =>
    {
      ws.send({msg, msgId})
    })
  ws.on("close", () => {
    closeHandler()
  })
})

export default router
