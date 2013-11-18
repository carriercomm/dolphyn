'use strict'

/* Controllers */

function MenuCtrl($scope, $log, $routeParams, $location, menuService) {

  $scope.currentMenu = $routeParams.menu
  $scope.unreadCount = ''

  $scope.$on('handleBroadcast', function() {
    if(menuService.message) {
      if(!menuService.message.unreadCount) {
        $scope.unreadCount = ''
        document.title = 'Dolphyn Mail';
      } else {
        $scope.unreadCount = menuService.message.unreadCount
        document.title = '('+$scope.unreadCount+') Dolphyn Mail';
      }
    }
  })

  $scope.compose = function() {
    $location.path('/app/Drafts/new')
  }

  $scope.changeMenu = function(menu) {
    $scope.currentMenu = menu
  }

  $log.info('MenuPageCtrl:' + $routeParams.menu)

  if($routeParams.menu === 'Account') {
    $scope.template = '/partials/account.html'
  } else {
    $scope.template = '/partials/box.html'
  }

}

function AppCtrl($scope, socket, $routeParams, $location, menuService) {
  socket.on('unauth:user', function() {
    if($location.path() !== '/login') {
      $location.path('/login')
    }
  })
}

function SettingsCtrl($scope, socket, $sce, $log) {
  $log.info('SettingsCtrl')

  $scope.saving = false

  $log.info('> get:settings')
  socket.emit('get:settings', undefined)

  socket.on('get:settings', function (settings) {
    $log.info('< get:settings')
    $scope.settings = settings
  })

  socket.on('error:settings', function (err) {
    $log.error(err)
    $scope.saving = false
  })

  socket.on('ok:settings', function () {
    $log.info('< ok:settings')
    $scope.saving = false
  })


  $scope.save = function() {
    $scope.saving = true
    socket.emit("save:settings", $scope.settings)
    return false
  }

  $scope.$on('$destroy', function (event) {
    socket.removeAllListeners();
    // or something like
    // socket.removeListener(this);
  });
}

function ComposeCtrl($scope, socket, $sce, $routeParams, menuService) {

}

function LoginCtrl($scope, socket, $location, $log, $rootScope) {

  $rootScope.logout = function() {
    $log.info("logout")
    socket.emit('unauth:user')
  }

  $scope.login = function() {
    // TODO: spinner
    $rootScope.authenticated = false
    socket.emit('auth:user', {
      email: $scope.email,
      password: $scope.password
    })
    return false
  }

  socket.on('auth:user', function(err) {
    if(err) {
      $rootScope.authenticated = false
      $log.error(err)// TODO: login feedback
    } else {
      $log.info('authenticated')
      $rootScope.authenticated = true
      $location.path('/app/INBOX/ALL')
    }
  })

  $scope.$on('$destroy', function (event) {
    socket.removeAllListeners();
  });
}

function BoxCtrl($rootScope, $scope, socket, $sce, $routeParams, menuService, $log) {

  $scope.messages = []
  $scope.selectedMessage

  $log.log('BoxCtrl')

  function unreadCount(value) {
    if(value !== undefined) {
      $scope.unreadCount = value
      $log.log('unreadCount = ' + $scope.unreadCount)
      menuService.prepForBroadcast({unreadCount: $scope.unreadCount})
    }
    if($scope.unreadCount === undefined) {
      $scope.unreadCount = 0
    }

    return $scope.unreadCount
  }

  $scope.boxId = $routeParams.menu

  if($routeParams.menu === 'Drafts') {
    $scope.edit = true
  }

  if($routeParams.resource === 'new') {
    $scope.selectedMessage = {}
  }

  if($routeParams.menu) {
    $scope.title = $routeParams.menu[0]
    $scope.title += $routeParams.menu.slice(1).toLowerCase()
  } else {
    $scope.title = ''
  }

  $scope.$on('handleBroadcast', function() {
  })

  var itemsPerRetrieve = 10

  $scope.loadMore = function() {
    $log.info('loading more mail')
    loadNext()
  }

  function endReached(self) {
    if(self && self[0]) {
      var end = ($(self).scrollTop() + $(self).innerHeight() >= $(self)[0].scrollHeight - 100)
      return end
    } else {
      return false
    }
  }

  var throttle = false

  if(!$rootScope.ready) {
    socket.on('ready', function() {
      $rootScope.ready = true
      $log.info('< ready')
      $log.info('> open:box ['+$scope.boxId+']')
      socket.emit('open:box', $scope.boxId)
    })
  } else {
    $log.info('> open:box ['+$scope.boxId+']')
    socket.emit('open:box', $scope.boxId)
  }

  socket.on('open:box', function(err, box) {
    if(err) {
      $log.error(err)
    } else {
      $log.info('< open:box ['+box.name+']')
      socket.emit("list:unseen:conversations")
      socket.emit("list:seen")
    }
  })

  var seenMessagesUids = []
  var currentMessageIndex = 0
  socket.on('list:seen', function(seenUids) {

    $log.info('< list:seen ['+seenUids.length+']')

    seenMessagesUids = seenUids
    loadNext()
  })

  function loadNext() {
    if(!throttle) {
      $scope.loading = true
      throttle = true

      var messagesUids = seenMessagesUids.slice(
        currentMessageIndex,
        Math.min(currentMessageIndex + itemsPerRetrieve, seenMessagesUids.length)
      )

      currentMessageIndex += itemsPerRetrieve

      if(messagesUids.length > 0) {
        $log.info('> list:conversations '+JSON.stringify(messagesUids))
        socket.emit("list:conversations", messagesUids)
      }

      setTimeout(function() {
        throttle = false
      }, 300)
    }
  }


  socket.on("list:unseen:conversations", function (messages) {
    loadMessages(messages)
  })

  socket.on('list:conversations', function (messages) {

    loadMessages(messages)

  })

  function loadMessages(messages) {

    $scope.loading = false

    for(var i = messages.length-1 ; i >= 0 ; i--) {

      if(lookupMessage(messages[i].attributes.uid)) {
        replaceExistingMessage(messages[i])
        continue
      }

      addReadableDate(messages[i])

      if(messages[i].isUnread) {
        var cnt = unreadCount()
        unreadCount(++cnt)
      }

      $scope.messages.push(messages[i])

    }

    $scope.messages.sort(sortByUnseenThenDate)
  }

  function addReadableDate(message) {
    message.date = new Date(message.headers.date)

    message.readableTime =
      message.date.getHours() +
        ":" +
        (message.date.getMinutes() < 10 ? "0" : "") +
        message.date.getMinutes()
  }

  function sortByUnseenThenDate(a, b) {
    var order = sortBySeen(a, b)

    if(order === 0) {
      order = sortByDate(a, b)
    }

    return order
  }

  function sortByDate(a, b) {
    if(a.date < b.date) {
      $log.debug(a.date + ' < ' + b.date)
      return 1
    } else if(a.date > b.date) {
      $log.debug(a.date + ' > ' + b.date)
      return -1
    } else {
      $log.debug(a.date + ' == ' + b.date)
      return 0
    }
  }

  function sortBySeen(a, b) {

    var res = 0

    if(a.isUnread && !b.isUnread) {
      $log.debug(a.isUnread + ' > ' + !b.isUnread)
      res = -1
    } else if(!a.isUnread && b.isUnread) {
      $log.debug(!a.isUnread + ' < ' + b.isUnread)
      res = 1
    } else {
      $log.debug(a.isUnread + ' == ' + b.isUnread)
    }

    return res
  }

  socket.on('get:message', function (messageWithBody) {
    $log.info('received full message '+messageWithBody.attributes.uid)

    var message = replaceExistingMessage(messageWithBody)
    // TODO: cache message
    // make sure the message is the currently selected one
    if(message &&
      (!$scope.selectedMessage ||
        $scope.selectedMessage.attributes.uid === messageWithBody.attributes.uid)) {

      if(typeof messageWithBody.html === "string") {
        message.trustedHtml = $sce.trustAsHtml(messageWithBody.html)
      }

      message.readableDate = DateHumanize.humanize(new Date(message.headers.date))

      // replace in the message list instead of selectedMessage
      $scope.selectedMessage = message
    }
  })

  socket.on('read:message', function(ack) {
    var message = lookupMessage(ack.messageUid)
    if(message && !ack.ok) {
      message.isUnread = true
    } else if(message) {
      $log.info('marking message ['+ack.messageUid+'] as read')
      message.isUnread = false
    } else {
      throw new Error('Could not match message')
    }
  })

  function lookupMessage(uid) {
    if($scope.messages) {
      for(var i = 0 ; i < $scope.messages.length ; i++) {
        if($scope.messages[i].attributes && $scope.messages[i].attributes.uid === uid) {
          return $scope.messages[i]
        }
      }
    }
    return undefined
  }

  function replaceExistingMessage(newVersion) {
    if($scope.messages) {
      for(var i = 0 ; i < $scope.messages.length ; i++) {
        // TODO: decrement unreadCount()
        if($scope.messages[i].attributes && $scope.messages[i].attributes.uid === newVersion.attributes.uid) {

          if($scope.messages[i].isUnread && !newVersion.isUnread) {
            var cnt = unreadCount()
            unreadCount(--cnt)
          }
          addReadableDate(newVersion)
          $scope.messages[i] = newVersion
          return newVersion
        }
      }
    }
    $scope.messages.sort(sortByUnseenThenDate)
    return undefined
  }

  $scope.getMessage = function (message) {
    $scope.selectedMessage = message

    // only load message if it does not have it's body yet
    if(message && !message.trustedHtml && message.attributes && message.attributes.uid) {
      socket.emit('get:message', message.attributes.uid)
    }
  }

  window.iResize = function() {
    var iFrames = $('iframe')
    for (var i = 0, j = iFrames.length; i < j; i++) {
      iFrames[i].style.height = (iFrames[i].contentWindow.document.body.offsetHeight + /*arbitrary*/50) + 'px'
    }
  }

  $scope.$on('$destroy', function (event) {
    socket.removeAllListeners();
  });

  $scope.send = function() {

    var message = {
      to: $scope.selectedMessage.to.split(','),
      subject: $scope.selectedMessage.subject,
      html: $scope.selectedMessage.html
    }

    socket.emit('send:message', message)
  }

}

var DateHumanize = {

  humanize: function(date) {
    var dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    var monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    var now = new Date()

    var dateString = ''



    if(date.getFullYear() !== now.getFullYear()) {

      if(date.getMonth() !== now.getMonth()) {

        dateString += monthName[date.getMonth()]
        dateString += ' ' + formatDay(date.getDate())
      }

      dateString += ', ' + date.getFullYear()

    } else {

      if(date.getMonth() !== now.getMonth()) {

        dateString += monthName[date.getMonth()]
        dateString += ' ' + formatDay(date.getDate())
        dateString += ', ' + formatTime(date)

      } else {

        if(date.getDate() <= (now.getDate() - 2)) {
          dateString += dayName[date.getDay()]
          dateString += ', ' + formatDay(date.getDate())
        } else {
          dateString += (date.getDate() == now.getDate()) ? 'Today' : 'Yesterday'
          dateString += ', ' + formatTime(date)
        }

      }

      return dateString
    }

    function formatDay(day) {
      switch(day) {
        case 1:
        case 21:
        case 31:
          return day + 'st'
        case 2:
        case 22:
          return day + 'nd'
        case 3:
        case 23:
          return day + 'rd'
        default:
          return day + 'th'
      }
    }

    function formatTime(date) {
      var readableTime = ''

      readableTime += date.getHours() + ':'

      if(date.getMinutes() < 10) {
        readableTime += '0'
      }

      readableTime += date.getMinutes()

      return readableTime
    }
  }

}