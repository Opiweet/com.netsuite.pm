/**
 * @NApiVersion 2.1
 */

define([
  "N/https",
  "N/ui/message",
  "N/currentRecord",
  "../../pm_config",
  "N/runtime",
], function (https, msg, currentrecord, pmConfig, runtime) {
  var VALUES;

  /**
   * Function to get VALUE
   * Based on environment to get NetSuite internal ids / list values.
   * @returns {Object}
   */
  function initiateValues() {
    const ids = pmConfig?.LIST_IDS || {};
    VALUES = {
      DOMAIN_URL: `https://${runtime.accountId}.app.netsuite.com`,
      REV_REC_STATUS_OPEN: ids?.REV_REC_STATUS?.OPEN || "1",
      REV_REC_STATUS_READY: ids?.REV_REC_STATUS?.READY || "2",
      REV_REC_TYPE: ids?.REV_REC_TYPE || { ACTUAL: "1", FORECAST: "2" },
      PHASE_STATUS: ids?.PHASE_STATUS || { REV_PLAN_CREATED: "2" },
    };

    return VALUES;
  }

  /**
   * Handles UI button interaction and triggers backend action requests.
   * Initializes environment values and routes actions based on the provided type.
   *
   * @param {string} url - Suitelet or RESTlet endpoint URL
   * @param {string} action - Action identifier (e.g., 'create_rev_plan')
   * @param {string} buttonId - DOM ID of the button triggering the action
   * @param {number|string} projectId - Internal ID of the project record
   *
   * @returns {void}
   */
  function btnFunctionality(url, action, buttonId, projectId) {
    initiateValues();

    let curRec = currentrecord.get();

    // Validate file existence
    if (action == "generate_rev_plans") {
      let title = "Creation of Revenue Plan - Please wait...";
      let refreshTime = 5000;
      let toReload = false;

      actionRequest(
        url,
        title,
        null,
        buttonId,
        refreshTime,
        action,
        toReload,
        curRec,
      );
    }
  }

  /**
   * Executes a bulk or single action on one or multiple project IDs.
   * Processes each project independently and aggregates results.
   *
   * @param {string} action - Action identifier (e.g., 'create_rev_plan')
   * @param {number|number[]} projectIds - Single project ID or array of project IDs
   *
   * @returns  response object with status and results array containing individual project outcomes
   * @governance 10 units
   */

  function executeAction(action, projectIds) {
    if (!Array.isArray(projectIds)) {
      projectIds = [projectIds];
    }

    let results = [];

    projectIds.forEach((projectId) => {
      try {
        if (action == "create_rev_plan") {
          let res = processSingleProject(projectId);
          results.push({
            projectId,
            status: "SUCCESS",
            type: res.type,
            message: res.message,
          });
        }
      } catch (e) {
        results.push({
          projectId,
          status: "ERROR",
          message: e.message || e,
        });
      }
    });

    return {
      status: "SUCCESS",
      results,
    };
  }

  /**
   * Handles the action request by making an HTTPS GET call to the provided URL and managing UI feedback.
   * Shows success, warning, or error messages based on the response
   * @governance 10 units
   * @param {*} url
   * @param {*} title
   * @param {*} message
   * @param {*} buttonId
   * @param {*} windowRefreshtime
   * @param {*} action
   */
  function actionRequest(
    url,
    title,
    message,
    buttonId,
    windowRefreshtime,
    action,
    toReload,
    curRec,
  ) {
    disableButton(buttonId);
    showLoader(title, message);

    const body = bodyFormat(action, curRec);

    https.post
      .promise({
        url,
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      })
      .then(function (response) {
        const responseBody = JSON.parse(response.body || "{}");
        hideLoader();

        if (responseBody?.success === true) {
          const result = responseBody?.data || {};
          let msgType = "CONFIRMATION";
          let title = "Success";
          let messageText = result?.message || "Operation completed";

          if (result?.type === "EXISTING") {
            msgType = "WARNING";
            title = "Already Exists";
          }
          if (result?.type === "WARNING" || result?.status === "WARNING") {
            msgType = "WARNING";
            title = "Warning";
          }

          postResponseMessage(
            title,
            messageText,
            msgType,
            windowRefreshtime,
            toReload,
            buttonId,
          );
          return;
        }

        const err = responseBody?.error || responseBody || {};
        postResponseMessage(
          err.title ?? "Error",
          err.message ?? "Operation failed. Please try again.",
          err.status == "WARNING" ? "WARNING" : "ERROR",
          5000,
          toReload,
          buttonId,
        );
      })
      .catch(function (reason) {
        console.log(reason);
        hideLoader();
        postResponseMessage(
          "Operation failed",
          "Please try again...",
          "ERROR",
          5000,
          toReload,
          buttonId,
        );
      });
  }
  /**
   * function to show a loader message box
   * @param {*} title
   * @param {*} messageText
   */
  function showLoader(title, messageText) {
    // Create a NetSuite message box with the loader inside
    loaderMsg = msg.create({
      title: title || "Generating Revenue Plan...",
      message: `
                <div style="text-align: center;">
                    <div class="loader"></div>
                    <p style="font-size: 12px; color: #666;">${messageText || "Please Wait."}</p>
                </div>
                <style>
                    .loader {
                        border: 3px solid #f3f3f3;
                        border-top: 3px solid #007bff;
                        border-radius: 50%;
                        width: 20px;
                        height: 20px;
                        margin: 10px auto;
                        animation: spin 1s linear infinite;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `,
      type: msg.Type.INFORMATION,
    });

    loaderMsg.show(); // Display the message
  }

  /**
   * function to hide the loader message box
   */
  function hideLoader() {
    if (loaderMsg) {
      loaderMsg.hide(); // Hide the message box
    }
  }

  /**
   * function to post a response message and refresh the page after a delay
   * @param {*} title
   * @param {*} msgTxt
   * @param {*} msgType
   * @param {*} windowRefreshtime
   */
  function postResponseMessage(
    title,
    msgTxt,
    msgType,
    windowRefreshtime = 2000,
    toReload = true,
    buttonId,
  ) {
    if (toReload)
      msgTxt += `</br></br>The page will auto-refresh in ${windowRefreshtime / 1000} seconds`;
    let postMsg = msg.create({
      title: title,
      message: msgTxt,
      type: msg.Type[msgType],
    });

    postMsg.show({ duration: windowRefreshtime }); // Display the message

    setTimeout(() => {
      if (toReload) window.location.reload();
      else enableButton(buttonId);
    }, windowRefreshtime);
  }

  /**
   * function to disable a button by its ID
   * @param {*} buttonid
   */
  function disableButton(buttonid) {
    var button = document.getElementById(buttonid);
    if (button) {
      button.disabled = true; // Disables the button
      button.style.opacity = "0.5"; // Optional: Make it look disabled
      console.log("Custom button disabled");
    } else {
      console.log("Button not found");
    }
  }

  /**
   * function to disable a button by its ID
   * @param {*} buttonid
   */
  function enableButton(buttonid) {
    var button = document.getElementById(buttonid);
    if (button) {
      button.disabled = false; // Disables the button
      button.style.opacity = "1"; // Optional: Make it look disabled
      console.log("Custom button enable");
    } else {
      console.log("Button not found");
    }
  }

  /**
   * Prepare request post body
   */
  function bodyFormat(action, curRec) {
    let body = {};

    if (action === "generate_rev_plans") {
      body = {
        action: action,
        projectId: curRec.id,
      };
    }

    return body;
  }

  return {
    VALUES: initiateValues,
    btnFunctionality: btnFunctionality,
    executeAction: executeAction,
  };
});
