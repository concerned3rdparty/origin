import React, { Component, Fragment } from 'react'
import { defineMessages, injectIntl } from 'react-intl'
import { connect } from 'react-redux'
import { withRouter } from 'react-router'
import queryString from 'query-string'

import {
  handleNotificationsSubscription,
  setMessagingEnabled,
  setMessagingInitialized,
  setNotificationsHardPermission,
  setNotificationsSoftPermission
} from 'actions/App'
import { addMessage } from 'actions/Message'
import { fetchNotifications } from 'actions/Notification'
import { fetchUser } from 'actions/User'

import BetaModal from 'components/modals/beta-modal'
import { RecommendationModal, WarningModal } from 'components/modals/notifications-modals'
import SellingModal from 'components/onboarding-modal'

import getCurrentNetwork from 'utils/currentNetwork'
import { createSubscription, requestPermission } from 'utils/notifications'
import scopedDebounce from 'utils/scopedDebounce'

import origin from '../services/origin'
import analytics from '../services/analytics'

const ETH_ADDRESS = process.env.MESSAGING_ACCOUNT
const ONE_SECOND = 1000
const storeKeys = {
  messageCongratsTimestamp: 'message_congrats_timestamp',
  messageWelcomeTimestamp: 'message_welcome_timestamp'
}

class Onboarding extends Component {
  constructor(props) {
    super(props)

    this.handleDismissNotificationsPrompt = this.handleDismissNotificationsPrompt.bind(this)
    this.handleDismissNotificationsWarning = this.handleDismissNotificationsWarning.bind(this)
    this.handleEnableNotifications = this.handleEnableNotifications.bind(this)
    this.intlMessages = defineMessages({
      congratsMessage: {
        id: 'onboarding.congrats',
        defaultMessage:
          'Congratulations! You can now message other users on Origin. ' +
          'Why not start by taking a look around and telling us what you think about our DApp?'
      },
      welcomeMessage: {
        id: 'onboarding.welcome',
        defaultMessage:
          'You can use Origin Messaging to chat with other users. ' +
          'Origin Messaging allows you to communicate with other users in a secure and decentralized way. ' +
          'Messages are private and, usually, can only be read by you or the recipient. ' +
          'In the case that either of you opens a dispute, messages can also be read by a third-party arbitrator.\n' +
          '\n' +
          'Get started with messaging in two steps. ' +
          'First, you will use your Ethereum wallet to enable Origin Messaging. ' +
          'Then you will sign your public messaging key so that other users can find and chat with you. ' +
          'Using Origin Messaging is free and will not cost you any ETH or Origin Token.'
      }
    })
    // ? consider using https://www.npmjs.com/package/redux-debounced
    this.debouncedFetchUser = scopedDebounce(
      addr => this.props.fetchUser(addr),
      ONE_SECOND
    )

    this.notificationsInterval = null
  }

  componentDidMount() {
    // detect loading of global keys database
    origin.messaging.events.on('initialized', accountKey => {
      this.props.setMessagingInitialized(!!accountKey)
    })

    // detect existing messaging account
    origin.messaging.events.on('ready', accountKey => {
      this.props.setMessagingEnabled(!!accountKey)
    })

    // detect new decrypted messages
    origin.messaging.events.on('msg', obj => {
      if (obj.decryption) {
        const { roomId, keys } = obj.decryption

        origin.messaging.initRoom(roomId, keys)
      }

      this.props.addMessage(obj)

      this.debouncedFetchUser(obj.senderAddress)
    })

    // To Do: handle incoming messages when no Origin Messaging Private Key is available
    origin.messaging.events.on('emsg', obj => {
      analytics.event('Notifications', 'ErrorNoDecryption')
      console.error('A message has arrived that could not be decrypted:', obj)
    })
  }

  componentDidUpdate(prevProps) {
    const {
      messages,
      messagingEnabled,
      messagingInitialized,
      web3Account
    } = this.props

    if (web3Account && !this.notificationsInterval) {
      // poll for notifications
      this.notificationsInterval = setInterval(() => {
        this.props.fetchNotifications()
      }, 10 * ONE_SECOND)
    }

    const welcomeAccountEnabled = ETH_ADDRESS && ETH_ADDRESS !== web3Account

    if (
      // wait for initialization so that account key is available in origin.js
      !messagingInitialized ||
      // no need to spoof messages if there is no account to handle replies
      !welcomeAccountEnabled
    ) {
      return
    }

    const roomId = origin.messaging.generateRoomId(ETH_ADDRESS, web3Account)
    const recipients = origin.messaging.getRecipients(roomId)

    if (!messages.find(({ hash }) => hash === 'origin-welcome-message')) {
      this.debouncedFetchUser(ETH_ADDRESS)

      const scopedWelcomeMessageKeyName = `${
        storeKeys.messageWelcomeTimestamp
      }:${web3Account}`
      const welcomeTimestampString = localStorage.getItem(
        scopedWelcomeMessageKeyName
      )
      const welcomeTimestamp = welcomeTimestampString
        ? new Date(+welcomeTimestampString)
        : Date.now()
      !welcomeTimestampString &&
        localStorage.setItem(
          scopedWelcomeMessageKeyName,
          JSON.stringify(welcomeTimestamp)
        )
      // spoof a welcome message á la Tom from MySpace
      const message = {
        created: welcomeTimestamp,
        content: this.props.intl.formatMessage(
          this.intlMessages.welcomeMessage
        ),
        hash: 'origin-welcome-message',
        index: -2,
        recipients,
        roomId,
        senderAddress: ETH_ADDRESS
      }
      message.status = origin.messaging.getStatus(message)
      this.props.addMessage(message)
    }
    // on messaging enabled
    if (messagingEnabled !== prevProps.messagingEnabled) {
      this.debouncedFetchUser(ETH_ADDRESS)

      const scopedCongratsMessageKeyName = `${
        storeKeys.messageCongratsTimestamp
      }:${web3Account}`
      const congratsTimestampString = localStorage.getItem(
        scopedCongratsMessageKeyName
      )
      const congratsTimestamp = congratsTimestampString
        ? new Date(+congratsTimestampString)
        : Date.now()
      !congratsTimestampString &&
        localStorage.setItem(
          scopedCongratsMessageKeyName,
          JSON.stringify(congratsTimestamp)
        )
      // spoof congratulations
      const message = {
        created: congratsTimestamp,
        content: this.props.intl.formatMessage(
          this.intlMessages.congratsMessage
        ),
        hash: 'origin-congrats-message',
        index: -1,
        recipients,
        roomId,
        senderAddress: ETH_ADDRESS
      }
      message.status = origin.messaging.getStatus(message)
      this.props.addMessage(message)
    }
  }

  handleDismissNotificationsPrompt(e) {
    e.preventDefault()
    analytics.event('Notifications', 'PromptDismissed')
    this.props.handleNotificationsSubscription('warning', this.props)
  }

  handleDismissNotificationsWarning(e) {
    e.preventDefault()
    analytics.event('Notifications', 'WarningDismissed')
    this.props.setNotificationsSoftPermission('denied')
    this.props.handleNotificationsSubscription(null, this.props)
  }

  async handleEnableNotifications() {
    analytics.event('Notifications', 'SoftPermissionGranted')
    this.props.setNotificationsSoftPermission('granted')
    this.props.handleNotificationsSubscription(null, this.props)

    const { serviceWorkerRegistration, web3Account } = this.props
    // need a registration object to subscribe
    if (!serviceWorkerRegistration) {
      analytics.event('Notifications', 'UnsupportedNoServiceWorker')
      return console.error('No service worker registered')
    }

    try {
      // will equal 'granted' or otherwise throw
      await requestPermission()
      analytics.event('Notifications', 'PermissionGranted')
      createSubscription(serviceWorkerRegistration, web3Account)
    } catch (error) {
      // permission not granted
      analytics.event('Notifications', 'PermissionNotGranted', error)
      console.error(error)
    }

    this.props.setNotificationsHardPermission(Notification.permission)
  }

  render() {
    const { children, location, networkId, notificationsSubscriptionPrompt } = this.props
    const query = queryString.parse(location.search)
    const currentNetwork = getCurrentNetwork(networkId)
    const networkType = currentNetwork && currentNetwork.type

    return (
      <Fragment>
        {children}
        {!query['skip-onboarding'] && (
          <Fragment>
            { networkType === 'Mainnet Beta' && <BetaModal /> }
            <SellingModal />
          </Fragment>
        )}
        { ['buyer', 'seller'].includes(notificationsSubscriptionPrompt) &&
          <RecommendationModal
            isOpen={true}
            role={notificationsSubscriptionPrompt}
            onCancel={this.handleDismissNotificationsPrompt}
            onSubmit={this.handleEnableNotifications}
          />
        }
        {notificationsSubscriptionPrompt === 'warning' &&
          <WarningModal
            isOpen={true}
            onCancel={this.handleDismissNotificationsWarning}
            onSubmit={this.handleEnableNotifications}
          />
        }
      </Fragment>
    )
  }
}

const mapStateToProps = ({ app, messages }) => ({
  messages,
  messagingEnabled: app.messagingEnabled,
  messagingInitialized: app.messagingInitialized,
  networkId: app.web3.networkId,
  notificationsHardPermission: app.notificationsHardPermission,
  notificationsSoftPermission: app.notificationsSoftPermission,
  notificationsSubscriptionPrompt: app.notificationsSubscriptionPrompt,
  pushNotificationsSupported: app.pushNotificationsSupported,
  serviceWorkerRegistration: app.serviceWorkerRegistration,
  web3Account: app.web3.account
})

const mapDispatchToProps = dispatch => ({
  addMessage: obj => dispatch(addMessage(obj)),
  fetchNotifications: () => dispatch(fetchNotifications()),
  fetchUser: addr => dispatch(fetchUser(addr)),
  handleNotificationsSubscription: (role, props) => dispatch(handleNotificationsSubscription(role, props)),
  setMessagingEnabled: bool => dispatch(setMessagingEnabled(bool)),
  setMessagingInitialized: bool => dispatch(setMessagingInitialized(bool)),
  setNotificationsHardPermission: result => dispatch(setNotificationsHardPermission(result)),
  setNotificationsSoftPermission: result => dispatch(setNotificationsSoftPermission(result))
})

export default withRouter(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )(injectIntl(Onboarding))
)
