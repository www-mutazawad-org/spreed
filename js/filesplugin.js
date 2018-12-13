/**
 *
 * @copyright Copyright (c) 2018, Daniel Calviño Sánchez (danxuliu@gmail.com)
 *
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

(function(OC, OCA) {

	'use strict';

	OCA.Talk = OCA.Talk || {};

	var roomsChannel = Backbone.Radio.channel('rooms');

	OCA.Talk.RoomForFileModel = function() {
	};
	OCA.Talk.RoomForFileModel.prototype = {

		join: function(currentFileId) {
			if (this._currentFileId === currentFileId) {
				return;
			}

			this.leave();

			this._currentFileId = currentFileId;

			var self = this;

			$.ajax({
				url: OC.linkToOCS('apps/spreed/api/v1', 2) + 'file/' + currentFileId,
				type: 'GET',
				beforeSend: function(request) {
					request.setRequestHeader('Accept', 'application/json');
				},
				success: function(ocsResponse) {
					if (self._currentFileId !== currentFileId) {
						// Leave, or join with a different id, was called while
						// waiting for the response; as it is not the latest one
						// just ignore it.
						return;
					}

					OCA.Talk.FilesPlugin.joinRoom(ocsResponse.ocs.data.token);
				},
				error: function() {
					if (self._currentFileId !== currentFileId) {
						// Leave, or join with a different id, was called while
						// waiting for the response; as it is not the latest one
						// just ignore it.
						return;
					}

					OC.Notification.showTemporary(t('spreed', 'Error while getting the room ID'), {type: 'error'});

					OCA.Talk.FilesPlugin.leaveCurrentRoom();
				}
			});
		},

		leave: function() {
			if (this._currentFileId === undefined) {
				return;
			}

			delete this._currentFileId;

			OCA.Talk.FilesPlugin.leaveCurrentRoom();
		}
	};

	OCA.Talk.TalkCallDetailFileInfoView = OCA.Files.DetailFileInfoView.extend({

		className: 'talkCallInfoView',

		initialize: function(options) {
			this._roomForFileModel = options.roomForFileModel;
			this._fileList = options.fileList;

			this._boundHideCallUi = this._hideCallUi.bind(this);

			this.listenTo(roomsChannel, 'joinedRoom', this.setActiveRoom);
			this.listenTo(roomsChannel, 'leaveCurrentRoom', this.setActiveRoom);
		},

		/**
		 * Sets the file info to be displayed in the view
		 *
		 * @param {OCA.Files.FileInfo} fileInfo file info to set
		 */
		setFileInfo: function(fileInfo) {
			if (!this._appStarted) {
				this.model = fileInfo;

				return;
			}

			if (this.model === fileInfo) {
				return;
			}

			this.model = fileInfo;

			this.render();
		},

		setActiveRoom: function(activeRoom) {
			this.stopListening(this._activeRoom, 'change:participantFlags', this._updateCallContainer);
			// Signaling uses its own event system, so Backbone methods can not
			// be used.
			OCA.SpreedMe.app.signaling.off('leaveCall', this._boundHideCallUi);

			this._activeRoom = activeRoom;

			if (activeRoom) {
				this.listenTo(activeRoom, 'change:participantFlags', this._updateCallContainer);
				// Signaling uses its own event system, so Backbone methods can
				// not be used.
				OCA.SpreedMe.app.signaling.on('leaveCall', this._boundHideCallUi);

				if (this._emptyContentView) {
					this._emptyContentView.setActiveRoom(activeRoom);
				}
			}
		},

		render: function() {
			// Detach the MediaControlsView before emptying its ancestor to
			// prevent internal listeners in MediaControlsView from becoming
			// unusable.
			OCA.SpreedMe.app._mediaControlsView.$el.detach();

			this.$el.empty();
			this._$callContainerWrapper = null;

			if (!this.model || this.model.get('type') === 'dir') {
				return;
			}

			this._$callContainerWrapper = $('<div id="call-container-wrapper" class="hidden"></div>');

			this.$el.append(this._$callContainerWrapper);
			$('#call-container-wrapper').append('<div id="call-container"></div>');
			$('#call-container-wrapper').append('<div id="emptycontent"><div id="emptycontent-icon" class="icon-loading"></div><h2></h2><p class="emptycontent-additional"></p></div>');
			$('#call-container').append('<div id="videos"><div id="localVideoContainer" class="videoView videoContainer"></div></div>');
			$('#call-container').append('<div id="screens"></div>');

			$('#localVideoContainer').append(
				'<video id="localVideo"></video>' +
				'<div class="avatar-container hidden">' +
				'	<div class="avatar"></div>' +
				'</div>');

			if (this._emptyContentView) {
				this._emptyContentView.destroy();
			}
			this._emptyContentView = new OCA.SpreedMe.Views.EmptyContentView({
				el: '#call-container-wrapper > #emptycontent',
			});

			OCA.SpreedMe.app._mediaControlsView.render();
			OCA.SpreedMe.app._mediaControlsView.hideScreensharingButton();
			$('#localVideoContainer').append(OCA.SpreedMe.app._mediaControlsView.$el);
		},

		_updateCallContainer: function() {
			var flags = this._activeRoom.get('participantFlags') || 0;
			var inCall = flags & OCA.SpreedMe.app.FLAG_IN_CALL !== 0;
			if (inCall) {
				this._showCallUi();
			} else {
				this._hideCallUi();
			}
		},

		_showCallUi: function() {
			if (!this._$callContainerWrapper || !this._$callContainerWrapper.hasClass('hidden')) {
				return;
			}

			this._fileList.getRegisteredDetailViews().forEach(function(detailView) {
				if (!(detailView instanceof OCA.Talk.TalkCallDetailFileInfoView)) {
					detailView.$el.addClass('hidden-by-call');
				}
			});

			this._$callContainerWrapper.removeClass('hidden');

			// The icon to close the sidebar overlaps the video, so use its
			// white version with a shadow instead of the black one.
			// TODO Change it only when there is a call in progress; while
			// waiting for other participants it should be kept black. However,
			// this would need to hook in "updateParticipantsUI" which is where
			// the "incall" class is set.
			$('#app-sidebar .icon-close').addClass('icon-white icon-shadow');
		},

		_hideCallUi: function() {
			// The _$callContainerWrapper could be undefined when changing to a
			// different file, so the detail views have to be unhidden in any
			// case.
			this._fileList.getRegisteredDetailViews().forEach(function(detailView) {
				if (!(detailView instanceof OCA.Talk.TalkCallDetailFileInfoView)) {
					detailView.$el.removeClass('hidden-by-call');
				}
			});

			// Restore the icon to close the sidebar.
			$('#app-sidebar .icon-close').removeClass('icon-white icon-shadow');

			if (!this._$callContainerWrapper || this._$callContainerWrapper.hasClass('hidden')) {
				return;
			}

			this._$callContainerWrapper.addClass('hidden');
		},

		setAppStarted: function() {
			this._appStarted = true;

			// Set again the file info now that the app has started.
			if (OCA.Talk.FilesPlugin.isTalkSidebarSupportedForFile(this.model)) {
				var fileInfo = this.model;
				this.model = null;
				this.setFileInfo(fileInfo);
			}
		},

	});

	/**
	 * Tab view for Talk chat in the details view of the Files app.
	 *
	 * This view shows the chat for the Talk room associated with the file. The
	 * tab is shown only for those files in which the Talk sidebar is supported,
	 * otherwise it is hidden.
	 */
	OCA.Talk.TalkChatDetailTabView = OCA.Files.DetailTabView.extend({

		id: 'talkChatTabView',

		/**
		 * Higher priority than other tabs.
		 */
		order: -10,

		initialize: function(options) {
			this._roomForFileModel = options.roomForFileModel;
			this._fileList = options.fileList;

			this.listenTo(roomsChannel, 'joinedRoom', this.setActiveRoom);
			this.listenTo(roomsChannel, 'leaveCurrentRoom', this.setActiveRoom);

			this.$el.append('<div class="app-not-started-placeholder icon-loading"></div>');
		},

		/**
		 * Returns a CSS class to force scroll bars in the chat view instead of
		 * in the whole sidebar.
		 */
		getTabsContainerExtraClasses: function() {
			return 'with-inner-scroll-bars force-minimum-height';
		},

		getLabel: function() {
			return t('spreed', 'Chat');
		},

		getIcon: function() {
			return 'icon-talk';
		},

		/**
		 * Returns whether the Talk tab can be displayed for the file.
		 *
		 * The tab is shown for all files except folders.
		 *
		 * @param OCA.Files.FileInfoModel fileInfo
		 * @return True if the tab can be displayed, false otherwise.
		 */
		canDisplay: function(fileInfo) {
			if (fileInfo && fileInfo.get('type') !== 'dir') {
				return true;
			}

			// If the Talk tab can not be displayed then the current room is
			// left; this must be done here because "setFileInfo" will not get
			// called with the new file if the tab can not be displayed.
			if (this._appStarted) {
				this._roomForFileModel.leave();
			} else {
				this.model = null;
			}

			return false;
		},

		/**
		 * Sets the FileInfoModel for the currently selected file.
		 *
		 * Rooms are associated to the id of the file, so the chat can not be
		 * loaded until the file info is set and the token for the room is got.
		 *
		 * @param OCA.Files.FileInfoModel fileInfo
		 */
		setFileInfo: function(fileInfo) {
			if (!this._appStarted) {
				this.model = fileInfo;

				return;
			}

			if (!OCA.Talk.FilesPlugin.isTalkSidebarSupportedForFile(fileInfo)) {
				this.model = null;

				this._roomForFileModel.leave();

				this._renderFileNotSharedUi();

				return;
			}

			if (this.model === fileInfo) {
				// If the tab was hidden and it is being shown again at this
				// point the tab has not been made visible yet, so the
				// operations need to be delayed. However, the scroll position
				// is saved before the tab is made visible to avoid it being
				// reset.
				// Note that the system tags may finish to load once the chat
				// view was already loaded; in that case the input for tags will
				// be shown, "compressing" slightly the chat view and thus
				// causing it to "lose" the last visible element (as the scroll
				// position is kept so the elements at the bottom are hidden).
				// Unfortunately there does not seem to be anything that can be
				// done to prevent that.
				var lastKnownScrollPosition = OCA.SpreedMe.app._chatView.getLastKnownScrollPosition();
				setTimeout(function() {
					OCA.SpreedMe.app._chatView.restoreScrollPosition(lastKnownScrollPosition);

					// Load the pending elements that may have been added while
					// the tab was hidden.
					OCA.SpreedMe.app._chatView.reloadMessageList();

					OCA.SpreedMe.app._chatView.focusChatInput();
				}, 0);

				return;
			}

			// Discard the call button until joining to the new room.
			if (this._callButton) {
				this._callButton.$el.remove();
				delete this._callButton;
			}

			this.model = fileInfo;

			if (!fileInfo || fileInfo.get('id') === undefined) {
				// This should never happen, except during the initial setup of
				// the Files app (and not even in that case due to having to
				// wait for the signaling settings to be fetched before
				// registering the tab).
				// Nevertheless, disconnect from the previous room just in case.
				OCA.Talk.FilesPlugin.leaveCurrentRoom();

				return;
			}

			this._roomForFileModel.join(this.model.get('id'));

			this.$el.find('.file-not-shared').remove();

			// If the details view is rendered again after the chat view has
			// been appended to this tab the chat view would stop working due to
			// the element being removed instead of detached, which would make
			// the references to its elements invalid (apparently even if
			// rendered again; "delegateEvents()" should probably need to be
			// called too in that case). However, the details view would only be
			// rendered again if new tabs were added, so in general this should
			// be safe.
			OCA.SpreedMe.app._chatView.$el.appendTo(this.$el);
			OCA.SpreedMe.app._chatView.setTooltipContainer($('#app-sidebar'));
			OCA.SpreedMe.app._chatView.focusChatInput();

			// At this point the tab has not been made visible yet, so the
			// reload needs to be delayed.
			setTimeout(function() {
				OCA.SpreedMe.app._chatView.reloadMessageList();
			}, 0);
		},

		_renderFileNotSharedUi: function() {
			this.$el.empty();

			var $fileNotSharedMessage = $(
				'<div class="emptycontent file-not-shared">' +
				'    <div class="icon icon-talk"></div>' +
				'    <h2>' + t('spreed', 'Start a conversation') + '</h2>' +
				'    <p>' + t('spreed', 'Share this file with others to discuss') + '</p>' +
				'    <button class="primary">' + t('spreed', 'Share') + '</button>' +
				'</div>');

			$fileNotSharedMessage.find('button').click(function() {
				// FileList.showDetailsView() is not used to prevent a
				// reload of the preview, which would cause flickering (although
				// the preview may be reloaded anyway if the share tab is opened
				// for the first time...).
				this._fileList._detailsView.selectTab('shareTabView');
			}.bind(this));

			this.$el.append($fileNotSharedMessage);
		},

		setActiveRoom: function(activeRoom) {
			if (!activeRoom) {
				if (this._callButton) {
					this._callButton.$el.remove();
					delete this._callButton;
				}

				return;
			}

			this._callButton = new OCA.SpreedMe.Views.CallButton({
				model: activeRoom,
				connection: OCA.SpreedMe.app.connection,
			});
			// Force initial rendering; changes in the room state will
			// automatically render the button again from now on.
			this._callButton.render();
			this._callButton.$el.prependTo(this.$el);
		},

		setAppStarted: function() {
			this._appStarted = true;

			this.$el.find('.app-not-started-placeholder').remove();

			// Set again the file info now that the app has started.
			if (this.model !== null) {
				var fileInfo = this.model;
				this.model = null;
				this.setFileInfo(fileInfo);
			}
		},

	});

	/**
	 * @namespace
	 */
	OCA.Talk.FilesPlugin = {
		ignoreLists: [
			'files_trashbin',
			'files.public'
		],

		attach: function(fileList) {
			// core sharing is disabled/not loaded
			if (!OC.Share) {
				return;
			}

			var self = this;
			if (this.ignoreLists.indexOf(fileList.id) >= 0) {
				return;
			}

			var roomForFileModel = new OCA.Talk.RoomForFileModel();
			var talkCallDetailFileInfoView = new OCA.Talk.TalkCallDetailFileInfoView({ roomForFileModel: roomForFileModel, fileList: fileList });
			var talkChatDetailTabView = new OCA.Talk.TalkChatDetailTabView({ roomForFileModel: roomForFileModel, fileList: fileList });

			OCA.SpreedMe.app.on('start', function() {
				self.setupSignalingEventHandlers();

				// While the app is being started the view just shows a
				// placeholder UI that is replaced by the actual UI once
				// started.
				talkCallDetailFileInfoView.setAppStarted();
				talkChatDetailTabView.setAppStarted();
			}.bind(this));

			fileList.registerDetailView(talkCallDetailFileInfoView);
			fileList.registerTabView(talkChatDetailTabView);

			// Unlike in the regular Talk app when Talk is embedded the
			// signaling settings are not initially included in the HTML, so
			// they need to be explicitly loaded before starting the app.
			OCA.Talk.Signaling.loadSettings().then(function() {
				OCA.SpreedMe.app.start();
			});
		},

		/**
		 * Returns whether the Talk tab can be displayed for the file.
		 *
		 * @return True if the file is shared with the current user or by the
		 *         current user to another user (as a user, group...), false
		 *         otherwise.
		 */
		isTalkSidebarSupportedForFile: function(fileInfo) {
			if (!fileInfo) {
				return false;
			}

			if (fileInfo.get('type') === 'dir') {
				return false;
			}

			if (fileInfo.get('shareOwnerId')) {
				// Shared with me
				// TODO How to check that it is not a remote share? At least for
				// local shares "shareTypes" is not defined when shared with me.
				return true;
			}

			if (!fileInfo.get('shareTypes')) {
				return false;
			}

			var shareTypes = fileInfo.get('shareTypes').filter(function(shareType) {
				// shareType could be an integer or a string depending on
				// whether the Sharing tab was opened or not.
				shareType = parseInt(shareType);
				return shareType === OC.Share.SHARE_TYPE_USER ||
						shareType === OC.Share.SHARE_TYPE_GROUP ||
						shareType === OC.Share.SHARE_TYPE_CIRCLE ||
						shareType === OC.Share.SHARE_TYPE_ROOM;
			});

			if (shareTypes.length === 0) {
				return false;
			}

			return true;
		},

		setupSignalingEventHandlers: function() {
			OCA.SpreedMe.app.signaling.on('joinRoom', function(joinedRoomToken) {
				if (OCA.SpreedMe.app.token !== joinedRoomToken) {
					return;
				}

				OCA.SpreedMe.app.signaling.syncRooms().then(function() {
					roomsChannel.trigger('joinedRoom', OCA.SpreedMe.app.activeRoom);

					OCA.SpreedMe.app._messageCollection.setRoomToken(OCA.SpreedMe.app.activeRoom.get('token'));
					OCA.SpreedMe.app._messageCollection.receiveMessages();
				});
			});

			// Chromium seems to drop a stream when the element it is attached
			// to is detached or reparented. The sidebar in the Files app is
			// open and closed using a jQuery animation, which reparents the
			// whole sidebar and then restores it at the end of the animation,
			// so closing the sidebar breaks an ongoing call in Chromium. To
			// prevent that, during a call the functions to open and close the
			// sidebar are replaced with custom versions that do not use an
			// animation.
			var showAppSidebarOriginal = OC.Apps.showAppSidebar;
			var hideAppSidebarOriginal = OC.Apps.hideAppSidebar;

			var showAppSidebarDuringCall = function($el) {
				var $appSidebar = $el || $('#app-sidebar');
				$appSidebar.removeClass('disappear');
				$('#app-content').trigger(new $.Event('appresized'));
			};

			var hideAppSidebarDuringCall = function($el) {
				var $appSidebar = $el || $('#app-sidebar');
				$appSidebar.addClass('disappear');
				$('#app-content').trigger(new $.Event('appresized'));
			};

			OCA.SpreedMe.app.signaling.on('joinCall', function() {
				OC.Apps.showAppSidebar = showAppSidebarDuringCall;
				OC.Apps.hideAppSidebar = hideAppSidebarDuringCall;
			});

			OCA.SpreedMe.app.signaling.on('leaveCall', function() {
				OC.Apps.showAppSidebar = showAppSidebarOriginal;
				OC.Apps.hideAppSidebar = hideAppSidebarOriginal;
			});

		},

		joinRoom: function(token) {
			OCA.SpreedMe.app.activeRoom = new OCA.SpreedMe.Models.Room({token: token});
			OCA.SpreedMe.app.signaling.setRoom(OCA.SpreedMe.app.activeRoom);

			OCA.SpreedMe.app.token = token;
			OCA.SpreedMe.app.signaling.joinRoom(token);
		},

		leaveCurrentRoom: function() {
			OCA.SpreedMe.app.signaling.leaveCurrentRoom();

			roomsChannel.trigger('leaveCurrentRoom');

			OCA.SpreedMe.app.token = null;
			OCA.SpreedMe.app.activeRoom = null;
		}

	};

	OCA.SpreedMe.app = new OCA.Talk.Embedded();

	OC.Plugins.register('OCA.Files.FileList', OCA.Talk.FilesPlugin);

})(OC, OCA);
