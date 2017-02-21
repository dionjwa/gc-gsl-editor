import React, { PropTypes, Component } from 'react';

import CodeEditorAce from './CodeEditorAce';
import Toolbar from './Toolbar';
import * as compiler from '../../behavior/compiler/client';
import * as canvas from '../../behavior/canvas/output';
import { toggleComments } from '../../behavior/editor/comments';
import { registerKeysRunCode } from '../../behavior/editor/keyBindings';

const config = require('../../behavior/compiler/config.json');
const extensionConfig = require('../../../package.json');
const gslState = require('../../../globals');

require('../../styles/styles.css');
/**
 * CodeEditorLayout groups together the components of the editor.
 *
 * Properties:
 *
 * {function} onEditorContentChange - A function to call when editor content changes.
 * {function} onSubmit - A function to call when the code execution results change.
 * {function} onToggleConsoleVisibility - A function to call when visibility of the output console is toggled.
 * {function} onStatusContentChange - A function to call when the editor's status bar content changes.
 * {bool} isConsoleOpen - True, if the output console is open.
 */
export default class CodeEditorLayout extends Component {
  static propTypes = {
    onEditorContentChange: PropTypes.func.isRequired,
    onSubmit: PropTypes.func.isRequired,
    onToggleConsoleVisibility: PropTypes.func.isRequired,
    onStatusContentChange: PropTypes.func.isRequired,
    isConsoleOpen: PropTypes.bool,
  };

  constructor(props) {
    super(props);
    this.state = {
      editorContent: '',
      resultContent: '',
      statusMessage: 'Begin typing GSL code.',
      currentMenuPosition: {},
      consoleVisible: true,
      toolbarItems: [
        {
          label: 'Run',
          action: this.runCode,
          imageUrl: '/images/ui/run_icon.svg',
        },
        {
          label: 'Show Console',
          action: this.showConsole,
        },
        {
          label: 'Save',
          action: this.saveCode,
          disabled: false,  // Make sure to update index references in saveCode if items are rearranged.
        },
        {
          label: 'Comment',
          action: this.toggleComment,
        },
        {
          label: 'Download',
          action: this.showDownloadMenu,
          imageUrl: '/images/ui/download_icon.svg',
        },
      ],
    };
  }

  /**
   * Actions to be performed when this component mounts.
   */
  componentDidMount() {
    // console.log('CodeEditorLayout componentDidMount');
    this.refreshDownloadMenu();
    if (gslState.hasOwnProperty('isConsoleOpen')) {
      this.props.onToggleConsoleVisibility(gslState.isConsoleOpen);
    }
    registerKeysRunCode(this.codeEditor.ace, this.runCode);

    const projectId = window.constructor.api.projects.projectGetCurrentId();

    //if project already loaded, just set as editor content
    if (gslState[projectId] && gslState[projectId].savedCode) {
      console.log('project ', projectId, ' has saved code');
      gslState.editorContent = gslState[projectId].savedCode;
      this.refreshEditorFromState();
    } else {
      //otherwise, load project and try to load settings
      this.codeEditor.ace.editor.env.editor.setReadOnly(true);
      this.onStatusMessageChange('Loading...');

      compiler.loadProjectCode(projectId)
        .catch(() => {
          return compiler.loadDefaults(projectId);
        })
        .then(() => {
          this.onStatusMessageChange('');
          this.refreshEditorFromState();
        });
    }
  }

  /**
   * Actions to be performed when the editor content changes
   * @param {string} content
   */
  onEditorContentChange = (content) => {
    this.setState({ editorContent: content });
    this.props.onEditorContentChange(content);

    // Enable or disable the 'Save' button based on the editor content.
    const projectId = window.constructor.api.projects.projectGetCurrentId();
    if (gslState.hasOwnProperty(projectId)) {
      const items = this.state.toolbarItems;
      if (gslState[projectId].hasOwnProperty('savedCode')) {
        if (content === gslState[projectId].savedCode) {
          items[2].disabled = true;
          this.setState({ toolbarItems: items });
        } else {
          items[2].disabled = false;
          this.setState({ toolbarItems: items });
        }
      } else {
        items[2].disabled = false;
        this.setState({ toolbarItems: items });
      }
    }
  };

  /**
   * Actions to be performed when the status message changes
   * @param {string} message
   */
  onStatusMessageChange = (message) => {
    this.setState({ statusMessage: message });
    this.props.onStatusContentChange(message);
    window.constructor.api.ui.uiSetGrunt(message);
  };

  /**
   * Actions to be performed when the result of the code execution changes
   * @param {string} content
   */
  onResultContentChange = (result) => {
    this.setState({ resultContent: result });
    this.props.onSubmit(result);
  };

  /**
   * update state of download menu items
   * @param settings
   */
  onDownloadMenuSettingsChange = (settings) => {
    this.downloadMenuItems.forEach(item => {
      // special case gsl
      if (item.type === 'gsl' && this.state.editorContent !== '') {
        item.disabled = false;
      } else {
        item.disabled = !settings[item.type];
      }
    });
  };

  /**
   * actions to be performed when the editor content changes
   * @param {string} content
   */
  refreshDownloadMenu = () => {
    compiler.getAvailableDownloadList(window.constructor.api.projects.projectGetCurrentId())
      .then((data) => {
        this.onDownloadMenuSettingsChange(data);
      });
  };

  /**
   * reload editor content from saved global state (cache)
   * @param {string} content
   */
  refreshEditorFromState = () => {
    this.onEditorContentChange(gslState.editorContent);
    this.onResultContentChange(gslState.resultContent);
    this.codeEditor.ace.editor.env.editor.setReadOnly(false);
  };

  /**
   * Toggles comments in the editor.
   */
  toggleComment = () => {
    toggleComments(this.codeEditor.ace);
  };

  /**
   * Expands the console window.
   */
  showConsole = () => {
    this.setState({ consoleVisible: true });
    this.props.onToggleConsoleVisibility(this.state.consoleVisible);
    gslState.isConsoleOpen = true;
    window.dispatchEvent(new Event('resize'));
    this.codeEditor.ace.editor.focus();
  };

  /**
   * Runs GSL code present in the editor
   * @param {MouseEvent} evt click event
   */
  runCode = (evt) => {
    console.log(`Sending code to the server: ${this.state.editorContent}`);

    this.onStatusMessageChange('Running code...');

    compiler.run(this.state.editorContent, config.arguments, window.constructor.api.projects.projectGetCurrentId()).then((data) => {
      this.onResultContentChange(data.result);

      if (data.status === 0) {
        this.onStatusMessageChange('GSL executed successfully.');
        canvas.render(JSON.parse(data.contents));
        this.refreshDownloadMenu();
      } else if (compiler.isPrimerFailure(data.result)) {
        this.onStatusMessageChange('Re-running the code without primers...');
        this.rerunCode(evt, compiler.removePrimerThumperArgs(config.arguments));
      } else {
        this.onStatusMessageChange('Running this code resulted in errors. Please check the console for details.');
        this.showConsole();
      }
    });
  };

  /**
   * Runs GSL code present in the editor
   * @param {MouseEvent} evt click event
   */
  rerunCode = (evt, newArgs) => {
    console.log(`Sending code to the server: ${this.state.editorContent}`);
    compiler.run(this.state.editorContent, newArgs, window.constructor.api.projects.projectGetCurrentId()).then((data) => {
      // retain the previous console error.
      const appendedResultOutput = this.state.resultContent + '\nResult on rerun without primers:\n' + data.result;
      this.onResultContentChange(appendedResultOutput);
      if (data.status === 0) {
        this.onStatusMessageChange('GSL executed successfully.');
        canvas.render(JSON.parse(data.contents));
        this.refreshDownloadMenu();
      } else {
        this.onStatusMessageChange('Running this code resulted in errors. Please check the console for details.');
        this.showConsole();
      }
    });
  };

  /**
   * Saves the GSL code associated with the project on the server.
   * @param {MouseEvent} click event
   */
  saveCode = (evt) => {
    const projectId = window.constructor.api.projects.projectGetCurrentId();

    return compiler.saveProjectCode(projectId, this.state.editorContent)
      .then(() => {
        this.onStatusMessageChange('Saved GSL code.');
        this.refreshDownloadMenu();
        this.codeEditor.ace.editor.focus();

        // disable the 'Save' Button
        const items = this.state.toolbarItems;
        if (gslState[projectId].hasOwnProperty('savedCode')) {
          items[2].disabled = true;
          this.setState({ toolbarItems: items });
        }
      })
      .catch((err) => {
        this.onStatusMessageChange('Failed to save the GSL code on the server.');
      });
  };

  downloadMenuItems = [
    {
      key: 'download-gsl-file',
      type: 'gsl',
      text: 'Source GSL',
      disabled: false,
      action: () => {
        this.doDownload('gsl');
      }
    },
    {},
    {
      key: 'download-ape-zip-file',
      type: 'ape',
      text: 'Output as ApE file archive',
      disabled: false,
      action: () => {
        this.doDownload('ape');
      },
    },
    {
      key: 'download-cm-zip-file',
      type: 'cm',
      text: 'Output as Clone Manager file achive',
      disabled: false,
      action: () => {
        this.doDownload('cm');
      },
    },
    {},
    {
      key: 'download-allFormats-zip-file',
      type: 'allFormats',
      text: 'All formats',
      disabled: false,
      action: () => {
        this.doDownload('allFormats');
      },
    },
  ];

  /**
   * Opens the download menu.
   * @param {MouseEvent} click event
   */
  showDownloadMenu = (evt) => {
    const showMenu = window.constructor.api.ui.uiShowMenu;
    showMenu(this.downloadMenuItems, {
      x: evt.pageX,
      y: evt.pageY,
    }, true);
  };

  /**
   * Downloads a file based on its type.
   * @param {string} The type of file as specified in downloadMenuItems
   */
  downloadFileByType = (fileType) => {
    const hyperlink = document.createElement('a');
    hyperlink.href = '/extensions/api/' + extensionConfig.name + '/download?projectId=' +
      window.constructor.api.projects.projectGetCurrentId() +
      '&extension=' + extensionConfig.name +
      '&type=' + fileType;

    hyperlink.download = true;
    console.log('REQUEST GSL DOWNLOAD:', hyperlink.href);
    const clickEvent = new MouseEvent("click", {
      "view": window,
      "bubbles": true,
      "cancelable": false
    });
    document.body.appendChild(hyperlink);
    hyperlink.dispatchEvent(clickEvent);

    (window.URL || window.webkitURL).revokeObjectURL(hyperlink.href);
    this.codeEditor.ace.editor.focus();
  }

  /**
   * Download a file depending on the item clicked
   * @param {MouseEvent} click event
   */
  doDownload(key) {
    const fileMap = {
      'gsl': 'GSL source code',
      'ape': 'ApE output zip file',
      'cm': 'Clone Manager output zip file',
      'allFormats': 'files',
    };
    const saveGSLAndDownload = (key) => {
      // Save file first if required, if the gsl file is requested.
      if ((key === 'gsl' || key === 'allFormats') && (!this.state.toolbarItems[2].disabled)) {
        // save the GSL file first before downloading.
        window.constructor.extensions.files.write(
          window.constructor.api.projects.projectGetCurrentId(),
          extensionConfig.name,
          'project.gsl',
          gslState.editorContent,
        )
          .then(() => {   // refactor this to separate the save part.
            gslState.refreshDownloadList = true;
            this.onStatusMessageChange('Preparing to download the ' + fileMap[key] + ' associated with this project...');
            this.downloadFileByType(key);
          })
          .catch((err) => {
            console.log('Failed to save GSL Code');
            console.log(err);
          });
      } else {
        this.onStatusMessageChange('Preparing to download the ' + fileMap[key] + ' associated with this project...');
        this.downloadFileByType(key);
      }
    };

    //for (const key of Object.keys(fileMap)) {
    saveGSLAndDownload(key);
    //}
    this.codeEditor.ace.editor.focus();
  }

  render() {
    if (gslState.refreshDownloadList) {
      this.refreshDownloadMenu();
      gslState.refreshDownloadList = false;
    }

    return (
      <div className="CodeEditorLayout">
        <Toolbar toolbarItems={this.state.toolbarItems}/>
        <CodeEditorAce
          ref={(el) => {
            if (el) {
              this.codeEditor = el;
            }
          }}
          callbackParent={this.onEditorContentChange}
          value={this.state.editorContent}
        />
      </div>
    );
  }
}
