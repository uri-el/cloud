(function () {
  "use strict";

  var app = angular.module("cloudShareApp", []);

  app.controller("MainController", function ($scope, $http, $timeout, $sce) {
    // -----------------------------
    // Trending tags
    // -----------------------------
    var computeTrendingTags = function (posts) {
      try {
        if (!posts || !Array.isArray(posts)) return [];

        var counts = {};
        posts.forEach(function (post) {
          if (!post) return;
          var tagsArray = normalizeTags(post.tags);
          tagsArray.forEach(function (tag) {
            var key = String(tag || "").trim().toLowerCase();
            if (!key) return;
            counts[key] = (counts[key] || 0) + 1;
          });
        });

        return Object.keys(counts)
          .sort(function (a, b) {
            return counts[b] - counts[a];
          })
          .slice(0, 10);
      } catch (e) {
        console.error("computeTrendingTags error:", e);
        return [];
      }
    };

    // -----------------------------
    // Config from index.html
    // -----------------------------
    var BLOB_CONTAINER_URL = window.BLOB_CONTAINER_URL || "";
    var CONTAINER_SAS = window.CONTAINER_SAS || "";

    var POSTS_CREATE_URL = window.POSTS_CREATE_URL || "";
    var POSTS_GET_URL = window.POSTS_GET_URL || "";
    var POSTS_DELETE_URL = window.POSTS_DELETE_URL || "";
    var POSTS_UPDATE_URL = window.POSTS_UPDATE_URL || "";

    // -----------------------------
    // State
    // -----------------------------
    $scope.currentView = "feed";
    $scope.posts = [];
    $scope.trendingTags = [];

    $scope.searchQuery = "";
    $scope.uploadData = { caption: "", tags: "" };
    $scope.selectedFile = null;

    $scope.uploading = false;
    $scope.uploadProgress = 0;

    $scope.toast = { show: false, message: "", type: "success" };

    $scope.showModal = false;
    $scope.currentPost = null;

    $scope.showEditModal = false;
    $scope.editPost = null;
    $scope.editTags = "";

    // -----------------------------
    // Helpers
    // -----------------------------
    function ensureLeadingQuestionMark(s) {
      if (!s) return "";
      return s.startsWith("?") ? s : "?" + s;
    }

    function toDisplayUrl(url) {
      if (!url) return url;
      if (url.indexOf("?") !== -1) return url;
      var sas = ensureLeadingQuestionMark(CONTAINER_SAS);
      if (!sas) return url;
      return url + sas;
    }

    function safeExtFromName(name) {
      var parts = (name || "").split(".");
      if (parts.length < 2) return "bin";
      var ext = parts.pop().toLowerCase();
      ext = ext.replace(/[^a-z0-9]/g, "");
      return ext || "bin";
    }

    function mediaTypeFromFileType(mime) {
      var mt = ((mime || "").split("/")[0] || "other").toLowerCase();
      return ["image", "video", "audio"].includes(mt) ? mt : "other";
    }

    function randomGuid() {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    // FIXED: normalize tags supports:
    // - array ["a","b"]
    // - string "a,b"
    // - string '["a","b"]' (JSON array string)
    function normalizeTags(tags) {
      if (tags === undefined || tags === null) return [];

      if (Array.isArray(tags)) {
        return tags
          .map(function (t) {
            return t == null ? "" : String(t).trim();
          })
          .filter(function (t) {
            return t.length > 0;
          });
      }

      if (typeof tags === "string") {
        var s = tags.trim();
        if (!s) return [];

        // JSON array string
        if (s[0] === "[" && s[s.length - 1] === "]") {
          try {
            var parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
              return parsed
                .map(function (t) {
                  return t == null ? "" : String(t).trim();
                })
                .filter(function (t) {
                  return t.length > 0;
                });
            }
          } catch (e) {
            // fall through
          }
        }

        // comma-separated
        return s
          .split(",")
          .map(function (t) {
            return t.trim();
          })
          .filter(function (t) {
            return t.length > 0;
          });
      }

      try {
        var str = String(tags).trim();
        return str ? [str] : [];
      } catch (e) {
        return [];
      }
    }

    function errText(err) {
      if (!err) return "";
      if (typeof err.data === "string") return err.data;
      try {
        return JSON.stringify(err.data);
      } catch (e) {
        return String(err.data);
      }
    }

    // -----------------------------
    // UI helpers
    // -----------------------------
    $scope.showToast = function (message, type) {
      $scope.toast.message = message;
      $scope.toast.type = type || "success";
      $scope.toast.show = true;
      $timeout(function () {
        $scope.toast.show = false;
      }, 2500);
    };

    $scope.navigateTo = function (view) {
      $scope.currentView = view;
      if (view === "feed") $scope.loadPosts();
    };

    $scope.trust = function (url) {
      return $sce.trustAsResourceUrl(url);
    };

    $scope.filteredPosts = function () {
      if (!$scope.posts) return [];
      var q = ($scope.searchQuery || "").toLowerCase().trim();
      if (!q) return $scope.posts;

      return $scope.posts.filter(function (p) {
        var cap = p && p.caption ? String(p.caption).toLowerCase() : "";
        var tags = normalizeTags(p && p.tags).join(",").toLowerCase();
        return cap.includes(q) || tags.includes(q);
      });
    };

    // -----------------------------
    // Feed load (Logic App)
    // -----------------------------
    $scope.loadPosts = function () {
      if (!POSTS_GET_URL) {
        $scope.showToast("Missing POSTS_GET_URL in index.html", "error");
        return;
      }

      $http.post(POSTS_GET_URL).then(
        function (res) {
          var d = res.data;
          var posts = [];

          if (Array.isArray(d)) posts = d;
          else if (d && d.Documents) posts = d.Documents;
          else if (d && d.documents) posts = d.documents;
          else if (d && d.value) posts = d.value;
          else if (d && d.items) posts = d.items;
          else if (d && typeof d === "object") posts = [d];

          posts = (posts || [])
            .map(function (post) {
              if (!post) return null;

              // FIXED: always normalize tags via normalizeTags()
              post.tags = normalizeTags(post.tags);

              if (post.blobUrl) post.blobUrl = toDisplayUrl(post.blobUrl);

              post.id = post.id || post._id || "";
              post.ownerId = post.ownerId || "";
              post.ownerName = post.ownerName || "User";
              post.createdAt = post.createdAt || new Date().toISOString();
              post.mediaType = post.mediaType || "other";

              return post;
            })
            .filter(function (p) {
              return p !== null;
            });

          $scope.posts = posts;
          $scope.trendingTags = computeTrendingTags(posts);
        },
        function (err) {
          console.error("Error loading posts:", err);
          $scope.showToast("Failed to load posts " + (err.status || "") + ": " + errText(err), "error");
        }
      );
    };

    // -----------------------------
    // File selection
    // -----------------------------
    $scope.onFileSelected = function (files) {
      if (!files || !files.length) return;
      $scope.$apply(function () {
        $scope.selectedFile = files[0];
      });
    };

    // -----------------------------
    // Delete flow
    // -----------------------------
    $scope.confirmDeletePost = function (post) {
      if (!post) return;

      var caption = (post.caption || "").toString().trim();
      var label = caption ? '"' + caption + '"' : "this post";
      if (!window.confirm("Delete " + label + "? This cannot be undone.")) return;

      $scope.deletePost(post);
    };

    $scope.deletePost = function (post) {
      if (!POSTS_DELETE_URL) {
        $scope.showToast("Missing POSTS_DELETE_URL in index.html", "error");
        return;
      }

      if (!(post && post.id && post.ownerId)) {
        $scope.showToast("Cannot delete: missing id or ownerId", "error");
        return;
      }

      $http.post(POSTS_DELETE_URL, { id: post.id, ownerId: post.ownerId }).then(
        function () {
          $scope.showToast("Post deleted", "success");

          $scope.posts = ($scope.posts || []).filter(function (p) {
            return !(p && p.id === post.id && p.ownerId === post.ownerId);
          });
          $scope.trendingTags = computeTrendingTags($scope.posts);
        },
        function (err) {
          $scope.showToast("Delete failed " + (err.status || "") + ": " + errText(err), "error");
        }
      );
    };

    // -----------------------------
    // Edit flow (FIXED: send id + ownerId)
    // -----------------------------
    $scope.openEditPost = function (post) {
      if (!post) return;

      if (!POSTS_UPDATE_URL) {
        $scope.showToast("Edit not configured (missing POSTS_UPDATE_URL)", "error");
        return;
      }

      $scope.editPost = angular.copy(post);
      $scope.editTags = normalizeTags($scope.editPost.tags).join(", ");
      $scope.showEditModal = true;
    };

    $scope.closeEditModal = function () {
      $scope.showEditModal = false;
      $scope.editPost = null;
      $scope.editTags = "";
    };

    $scope.savePostEdits = function () {
      if (!POSTS_UPDATE_URL) {
        $scope.showToast("Edit not configured (missing POSTS_UPDATE_URL)", "error");
        return;
      }
      if (!$scope.editPost) return;

      if (!($scope.editPost.id && $scope.editPost.ownerId)) {
        $scope.showToast("Cannot update: missing id or ownerId", "error");
        return;
      }

      var tagsArray = normalizeTags($scope.editTags);

      var payload = {
        id: $scope.editPost.id,
        ownerId: $scope.editPost.ownerId,
        caption: $scope.editPost.caption || "",
        tags: tagsArray
      };

      $http.post(POSTS_UPDATE_URL, payload).then(
        function () {
          $scope.showToast("Post updated", "success");
          $scope.closeEditModal();
          $scope.loadPosts();
        },
        function (err) {
          $scope.showToast("Update failed " + (err.status || "") + ": " + errText(err), "error");
        }
      );
    };

    // -----------------------------
    // Upload flow
    // -----------------------------
    $scope.handleUpload = function () {
      if (!$scope.selectedFile) {
        $scope.showToast("Please select a file", "error");
        return;
      }

      if (!BLOB_CONTAINER_URL || !CONTAINER_SAS) {
        $scope.showToast("Missing BLOB_CONTAINER_URL or CONTAINER_SAS in index.html", "error");
        return;
      }

      if (!POSTS_CREATE_URL) {
        $scope.showToast("Missing POSTS_CREATE_URL in index.html", "error");
        return;
      }

      var file = $scope.selectedFile;
      var ext = safeExtFromName(file.name);
      var mediaType = mediaTypeFromFileType(file.type);

      $scope.uploading = true;
      $scope.uploadProgress = 0;

      var blobName = randomGuid() + "-" + Date.now() + "." + ext;
      var container = BLOB_CONTAINER_URL.replace(/\/+$/, "");
      var blobUrl = container + "/" + blobName;

      var sasUrl = blobUrl + ensureLeadingQuestionMark(CONTAINER_SAS);

      var xhr = new XMLHttpRequest();
      xhr.open("PUT", sasUrl, true);
      xhr.setRequestHeader("x-ms-blob-type", "BlockBlob");
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

      xhr.upload.onprogress = function (evt) {
        if (!evt.lengthComputable) return;
        $scope.$apply(function () {
          $scope.uploadProgress = Math.round((evt.loaded / evt.total) * 100);
        });
      };

      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
          $scope.$apply(function () {
            $scope.uploading = false;
            $scope.showToast("Upload failed (Blob PUT): " + xhr.status, "error");
          });
          return;
        }

        var postData = {
          blobUrl: blobUrl,
          blobName: blobName,
          caption: $scope.uploadData.caption || "",
          tags: normalizeTags($scope.uploadData.tags),
          mediaType: mediaType
        };

        $http.post(POSTS_CREATE_URL, postData).then(
          function () {
            $scope.showToast("Upload successful!", "success");
            $scope.uploading = false;

            $scope.selectedFile = null;
            $scope.uploadData = { caption: "", tags: "" };

            var fi = document.getElementById("fileInput");
            if (fi) fi.value = "";

            $scope.navigateTo("feed");
          },
          function (err) {
            $scope.uploading = false;
            $scope.showToast("Uploaded but failed to save metadata " + (err.status || "") + ": " + errText(err), "error");
          }
        );
      };

      xhr.onerror = function () {
        $scope.$apply(function () {
          $scope.uploading = false;
          $scope.showToast("Upload failed (network). Check Storage CORS + SAS", "error");
        });
      };

      xhr.send(file);
    };

    // -----------------------------
    // View modal
    // -----------------------------
    $scope.viewPost = function (post) {
      $scope.currentPost = post;
      $scope.showModal = true;
    };

    $scope.closeModal = function () {
      $scope.showModal = false;
      $scope.currentPost = null;
    };

    // Initial load
    $scope.loadPosts();
  });
})();
